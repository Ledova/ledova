import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  COMPANY_TOKEN_ENDPOINTS,
  formatDateTime,
  formatShareCount,
  getErrorMessage,
  requestShares,
  useCompanyIssueInstructions,
  registerIssueExecutionState,
  REGISTER_ISSUE_COPY as COPY,
  REGISTER_ISSUE_DECISIONS,
  REGISTER_ISSUE_UNMET_COPY,
  REGISTER_LINK_COPY,
  REGISTER_LINK_DECISIONS,
  type RegisterIssue,
  type RegisterIssueSnapshot,
  type RegisterLink,
  type RegisterDecisionKind,
} from '@ledova/shared';
import { Action, Row, Rows, Section } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { RegisterCopy } from '../company-register/RegisterCopy';
import { RegisterDecision } from '../company-register/RegisterDecision';
import { EvidencePicker, Field, isoDay, utcToday } from '../company-register/RegisterFields';
import { useRegisterEvidence } from '../company-register/useRegisterEvidence';
import { useCompanyStyles } from '../company-register/styles';
import type { useTokenDetail } from './useTokenDetail';

type Read = ReturnType<typeof useTokenDetail>;
type Commands = ReturnType<typeof useCompanyIssueInstructions>;
type DocumentKind = 'authority' | 'terms' | 'acceptance';
const KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];
const STAGES: Record<string, string> = COPY.STAGES;

function SnapshotRows({ snapshot }: { snapshot: RegisterIssueSnapshot }) {
  const styles = useCompanyStyles();
  return (
    <Rows>
      <Row label="Company">{snapshot.company.name}</Row>
      <Row label="ACN">{snapshot.company.acn}</Row>
      <Row label="Share class">
        {snapshot.token.name} · {snapshot.token.symbol}
      </Row>
      <Row label="Member">
        {snapshot.member.name} · {snapshot.member.uuid}
      </Row>
      <Row label="Residential address">{snapshot.member.residentialAddress}</Row>
      <Row label="Member identity source">{snapshot.member.identitySource}</Row>
      <Row label="Nominated wallet">
        <Text selectable style={styles.text}>
          {snapshot.wallet.address}
        </Text>
      </Row>
      <Row label="Nomination">{snapshot.wallet.nomination}</Row>
      <Row label="Company wallet approval">{snapshot.wallet.approval}</Row>
      <Row label="Possession proof completed">{formatDateTime(snapshot.wallet.proofCompletedAt)}</Row>
      <Row label="Eligibility expires">{formatDateTime(snapshot.wallet.eligibilityExpiresAt)}</Row>
      <Row label="Wallet approval expires">{formatDateTime(snapshot.wallet.expiresAt)}</Row>
      <Row label="Register opening">{snapshot.register.opening}</Row>
      <Row label="Captured register sequence">{snapshot.register.sequence}</Row>
      <Row label="Captured register head">{snapshot.register.headHash}</Row>
      <Row label="Captured issued shares">{formatShareCount(snapshot.register.issuedSupply)}</Row>
      <Row label="Captured member holding">{formatShareCount(snapshot.register.currentShares)}</Row>
      <Row label="Authorised shares">{formatShareCount(snapshot.token.authorisedShares)}</Row>
    </Rows>
  );
}

function IssueRecord({ record, commands, epoch }: { record: RegisterIssue; commands: Commands; epoch: number }) {
  const styles = useCompanyStyles();
  const description = `company grant ${record.uuid}, prepared ${formatDateTime(record.createdAt)}`;
  const execution = record.execution;
  const documents: DocumentKind[] = record.acceptanceEvidence
    ? ['authority', 'terms', 'acceptance']
    : ['authority', 'terms'];
  return (
    <View style={styles.entry}>
      <Text style={styles.heading}>{STAGES[record.stage] ?? record.stage}</Text>
      <Text style={styles.muted}>Terms, director and authority provided by the company.</Text>
      <SnapshotRows snapshot={record.snapshot} />
      <Rows>
        <Row label="Shares to grant">{formatShareCount(record.shares)}</Row>
        <Row label="Terms dated on">{record.termsOn}</Row>
        <Row label="Non-paid grant terms">{record.terms}</Row>
        <Row label="Approving director">{record.approvingDirector}</Row>
        <Row label="Company authority reference">{record.authorityReference}</Row>
        <Row label="Reason for grant">{record.reason}</Row>
        <Row label="Recipient acceptance">
          {record.acceptanceRequired ? 'Required, evidence retained' : 'Not required by these terms'}
        </Row>
        <Row label="Preparation ID">{record.uuid}</Row>
        <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
        <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>
        <Row label="Intent fingerprint">{record.intentDigest}</Row>
        {record.decisions.map((decision) => (
          <Row key={decision.uuid} label={COPY.DECISIONS[decision.kind]}>
            {[decision.decidedByName, formatDateTime(decision.decidedAt), decision.reason].filter(Boolean).join(' · ')}
          </Row>
        ))}
        {!!record.rejectionReason && <Row label="Rejection reason">{record.rejectionReason}</Row>}
        {!!record.approvalDecision && <Row label="Consumed approval">{record.approvalDecision}</Row>}
        <Row label="Issuance request">{record.request}</Row>
        <Row label="Execution">{registerIssueExecutionState(record)}</Row>
        {!!execution && <Row label="Original execution">{execution.execution}</Row>}
        {!!execution?.dispatchId && <Row label="Original dispatch">{execution.dispatchId}</Row>}
        {!!execution?.operationId && <Row label="Original operation">{execution.operationId}</Row>}
        {!!execution?.claimId && <Row label="Original claim">{execution.claimId}</Row>}
        {!!execution?.txHash && <Row label="Transaction hash">{execution.txHash}</Row>}
        {!!execution?.blockNumber && <Row label="Chain receipt block">{execution.blockNumber}</Row>}
        {!!execution?.registerEntry && <Row label="Register entry">{execution.registerEntry}</Row>}
        <Row label="Actual register entry date">{execution?.effectiveOn || 'Not recorded'}</Row>
      </Rows>
      <Text style={styles.muted}>
        Application admits the original execution. A finalised Mint and its register entry establish the holding; the
        terms date is retained separately.
      </Text>
      {record.executionUnmetRequirements.map((code) => (
        <Text key={code} style={styles.muted}>
          {REGISTER_ISSUE_UNMET_COPY[code] ?? code}
        </Text>
      ))}
      {documents.map((kind) => (
        <RegisterCopy
          key={kind}
          label={`Download ${kind} document`}
          accessibilityLabel={`Download ${kind} document of ${description}`}
          filename={`${kind}-${record.uuid}`}
          epoch={epoch}
          guard={commands.guard}
          read={() => {
            commands.guard();
            const config = {
              responseType: 'arraybuffer',
              ledovaSessionEpoch: epoch,
              ledovaSubmissionGuard: commands.guard,
            } as const;
            if (kind === 'authority')
              return apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_ISSUE_FILE(record.uuid), config);
            if (kind === 'terms')
              return apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_ISSUE_TERMS_FILE(record.uuid), config);
            return apiClient.get<ArrayBuffer>(
              COMPANY_TOKEN_ENDPOINTS.REGISTER_ISSUE_ACCEPTANCE_FILE(record.uuid),
              config,
            );
          }}
        />
      ))}
      <View style={styles.choices}>
        {KINDS.map((kind) => (
          <RegisterDecision
            key={kind}
            family={REGISTER_ISSUE_DECISIONS}
            copy={COPY}
            noun="company grant"
            proposal={record}
            kind={kind}
            appointment={commands.steps[kind]?.uuid}
            enabled={commands.visible && record.status === 'submitted'}
            visible={commands.visible}
            readGuard={commands.guard}
            newEffectGuard={() => commands.guardIssue(kind, record)}
            epoch={epoch}
            description={description}
            onDecided={commands.accept}
            onSettled={commands.refresh}
            onRefused={commands.refresh}
          >
            {(preview) => (
              <>
                <SnapshotRows snapshot={preview.snapshot} />
                <Rows>
                  <Row label="Shares to grant">{formatShareCount(preview.shares)}</Row>
                  <Row label="Terms dated on">{preview.termsOn}</Row>
                  <Row label="Non-paid grant terms">{preview.terms}</Row>
                  <Row label="Approving director">{preview.approvingDirector}</Row>
                  <Row label="Company authority reference">{preview.authorityReference}</Row>
                  <Row label="Reason for grant">{preview.reason}</Row>
                  <Row label="Recipient acceptance">
                    {preview.acceptanceRequired ? 'Required' : 'Not required by these terms'}
                  </Row>
                  <Row label="Register sequence">{preview.registerSequence}</Row>
                  <Row label="Member holding">
                    {formatShareCount(preview.currentShares)} → {formatShareCount(preview.afterShares)}
                  </Row>
                  <Row label="Issued shares">
                    {formatShareCount(preview.issuedSupply)} → {formatShareCount(preview.afterIssuedSupply)}
                  </Row>
                  <Row label="Reserved shares">{formatShareCount(preview.reservedShares)}</Row>
                  <Row label="Available shares">{formatShareCount(preview.availableShares)}</Row>
                  <Row label="Authorised shares">{formatShareCount(preview.authorisedSupply)}</Row>
                </Rows>
                <Text style={styles.muted}>
                  Application queues the original mint. It does not immediately issue shares or record a register entry.
                </Text>
              </>
            )}
          </RegisterDecision>
        ))}
      </View>
    </View>
  );
}

function LinkRecord({ record, commands, epoch }: { record: RegisterLink; commands: Commands; epoch: number }) {
  const styles = useCompanyStyles();
  const description = `selected wallet link ${record.uuid}`;
  return (
    <View style={styles.entry}>
      <Text style={styles.heading}>{REGISTER_LINK_COPY.STAGES[record.stage] ?? record.stage} wallet link</Text>
      {record.mapping.map((row) => (
        <Text key={row.address} style={styles.text}>
          {row.address} → {row.member}
        </Text>
      ))}
      <Rows>
        <Row label="Approving director">{record.approvingDirector}</Row>
        <Row label="Authority reference">{record.authorityReference}</Row>
        <Row label="Reason">{record.reason}</Row>
        {record.decisions.map((decision) => (
          <Row key={decision.uuid} label={REGISTER_LINK_COPY.DECISIONS[decision.kind]}>
            {[decision.decidedByName, formatDateTime(decision.decidedAt)].filter(Boolean).join(' · ')}
          </Row>
        ))}
      </Rows>
      <RegisterCopy
        label="Download wallet link authority"
        accessibilityLabel={`Download authority document of ${description}`}
        filename={`link-authority-${record.uuid}`}
        epoch={epoch}
        guard={commands.guard}
        read={() =>
          apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_LINK_FILE(record.uuid), {
            responseType: 'arraybuffer',
            ledovaSessionEpoch: epoch,
            ledovaSubmissionGuard: commands.guard,
          })
        }
      />
      <View style={styles.choices}>
        {KINDS.map((kind) => (
          <RegisterDecision
            key={kind}
            family={REGISTER_LINK_DECISIONS}
            copy={REGISTER_LINK_COPY}
            noun="wallet link"
            proposal={record}
            kind={kind}
            appointment={commands.steps[kind]?.uuid}
            enabled={commands.visible && record.status === 'submitted'}
            visible={commands.visible}
            readGuard={commands.guard}
            newEffectGuard={() => commands.guardLink(kind, record)}
            epoch={epoch}
            description={description}
            onDecided={commands.acceptLink}
            onSettled={commands.refresh}
            onRefused={commands.refresh}
          >
            {(preview) => (
              <>
                <Text style={styles.muted}>{REGISTER_LINK_COPY.APPLY_NOTE}</Text>
                {preview.links.map((row) => (
                  <Text key={row.address} style={styles.text}>
                    {row.address} → {row.member}
                  </Text>
                ))}
              </>
            )}
          </RegisterDecision>
        ))}
      </View>
    </View>
  );
}

function Preparation({ commands }: { commands: Commands }) {
  const styles = useCompanyStyles();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const [nomination, setNomination] = useState('');
  const [walletApproval, setWalletApproval] = useState('');
  const [member, setMember] = useState('');
  const [newMember, setNewMember] = useState(false);
  const [shares, setShares] = useState('');
  const [termsOn, setTermsOn] = useState(utcToday());
  const [terms, setTerms] = useState('');
  const [director, setDirector] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [acceptanceRequired, setAcceptanceRequired] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authority = useRegisterEvidence(commands.company, 'authority');
  const termsDocument = useRegisterEvidence(commands.company, 'supporting');
  const acceptance = useRegisterEvidence(commands.company, 'supporting');
  const chosen = commands.nominations.data?.find((row) => row.uuid === nomination);
  const approvals = (commands.walletApprovals.data ?? []).filter(
    (row) =>
      row.nomination === nomination &&
      row.action === 'add' &&
      !!row.changeId &&
      ['confirmed', 'unchanged'].includes(row.execution?.status ?? '') &&
      Number.isFinite(Date.parse(row.expiresAt ?? '')) &&
      Date.parse(row.expiresAt!) > now,
  );
  const linked = (commands.links.data ?? []).some(
    (row) =>
      row.status === 'applied' &&
      row.mapping.some(
        (mapping) => mapping.member === member && mapping.address.toLowerCase() === chosen?.address.toLowerCase(),
      ),
  );
  const busy = submitting || commands.busy || authority.busy || termsDocument.busy || acceptance.busy;
  const commonProblem =
    !chosen || chosen.unmetRequirements.length
      ? 'Choose one current participant nomination.'
      : !member
        ? 'Choose an existing member or create a new member identifier.'
        : !director.trim() || !reference.trim() || !reason.trim()
          ? 'Give the approving director, authority reference and reason.'
          : !authority.name
            ? 'Choose the authority document.'
            : null;
  const issueProblem =
    commonProblem ||
    (!linked
      ? 'Apply the exact selected wallet link before preparing a grant.'
      : !approvals.some((row) => row.changeId === walletApproval)
        ? 'Choose the exact confirmed company approval for this nomination.'
        : requestShares(shares) === null
          ? 'Enter whole shares from 1 to 2,147,483,647.'
          : !isoDay(termsOn.trim()) || termsOn.trim() > utcToday()
            ? 'Enter a valid terms date, today (UTC) or earlier.'
            : !terms.trim() || !termsDocument.name
              ? 'Give the non-paid terms and choose their document.'
              : acceptanceRequired === null
                ? 'State whether these terms require recipient acceptance.'
                : acceptanceRequired && !acceptance.name
                  ? 'Choose the required acceptance document.'
                  : null);
  const pick = async (document: ReturnType<typeof useRegisterEvidence>) => {
    setError(null);
    try {
      commands.guardStep('prepare');
      await document.pick();
      commands.guardStep('prepare');
    } catch (cause) {
      if (commands.visible) setError(getErrorMessage(cause, 'The document could not be selected.'));
    }
  };
  const submit = async (kind: 'link' | 'issue') => {
    if (busy || !commands.canPrepare || (kind === 'link' ? commonProblem : issueProblem)) return;
    setSubmitting(true);
    setError(null);
    try {
      const mapping = [{ address: chosen!.address, member }];
      const guard = () => {
        if (kind === 'link') commands.guardLink('prepare', { mapping, nomination });
        else commands.guardIssue('prepare', { member, nomination, walletApproval });
      };
      guard();
      const appointment = commands.steps.prepare!.uuid;
      const retainedAuthority = await authority.upload(appointment, guard);
      guard();
      if (kind === 'link') {
        await commands.sendLink(
          {
            authorityEvidence: retainedAuthority.uuid,
            mapping,
            authority: 'director_resolution',
            approvingDirector: director.trim(),
            authorityReference: reference.trim(),
            reason: reason.trim(),
          },
          nomination,
        );
      } else {
        const retainedTerms = await termsDocument.upload(appointment, guard);
        guard();
        const accepted = acceptanceRequired ? await acceptance.upload(appointment, guard) : null;
        guard();
        await commands.sendIssue({
          member,
          nomination,
          walletApproval,
          shares: shares.trim(),
          approvingDirector: director.trim(),
          authorityReference: reference.trim(),
          reason: reason.trim(),
          termsOn: termsOn.trim(),
          terms: terms.trim(),
          acceptanceRequired: acceptanceRequired!,
          authorityEvidence: retainedAuthority.uuid,
          termsEvidence: retainedTerms.uuid,
          acceptanceEvidence: accepted?.uuid ?? null,
        });
      }
    } catch (cause) {
      try {
        commands.guard();
        setError(getErrorMessage(cause, 'The company preparation could not be completed.'));
      } catch {
        return;
      }
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>Prepare a non-paid company grant</Text>
      <Text style={styles.muted}>
        Select the participant’s explicit nomination and the company’s documented member. The company chooses this
        association.
      </Text>
      {(commands.nominations.data ?? []).map((row) => (
        <Action
          key={row.uuid}
          label={`Use nominated wallet ${row.address}`}
          disabled={busy || nomination === row.uuid || !!row.unmetRequirements.length}
          onPress={() => {
            setNomination(row.uuid);
            setWalletApproval('');
          }}
        />
      ))}
      {chosen && (
        <Rows>
          <Row label="Selected nomination">{chosen.uuid}</Row>
          <Row label="Selected wallet">{chosen.address}</Row>
          <Row label="Proof completed">{formatDateTime(chosen.proofCompletedAt)}</Row>
          <Row label="Eligibility expires">{formatDateTime(chosen.eligibilityExpiresAt)}</Row>
        </Rows>
      )}
      <Text style={styles.heading}>Member</Text>
      {(commands.members.data?.members ?? []).map((row) => (
        <Action
          key={row.member}
          label={`Use member ${row.name || row.member}`}
          accessibilityLabel={`Use member ${row.name || 'unnamed'} ${row.member}`}
          disabled={busy || member === row.member}
          onPress={() => {
            setMember(row.member);
            setNewMember(false);
          }}
        />
      ))}
      <Action
        label="Use a new member"
        disabled={busy || newMember}
        onPress={() => {
          setMember(Crypto.randomUUID());
          setNewMember(true);
        }}
      />
      {!!member && (
        <Text selectable style={styles.text}>
          Selected {newMember ? 'new ' : ''}member: {member}
        </Text>
      )}
      <Field label="Approving director" value={director} editable={!busy} maxLength={255} onChange={setDirector} />
      <Text style={styles.muted}>
        The company names a director other than the recipient. No director account is required.
      </Text>
      <Field
        label="Company authority reference"
        value={reference}
        editable={!busy}
        maxLength={255}
        onChange={setReference}
      />
      <Field
        label="Reason for grant or wallet link"
        value={reason}
        editable={!busy}
        maxLength={1000}
        multiline
        onChange={setReason}
      />
      <EvidencePicker
        title="Authority document"
        noun="authority document"
        evidence={authority}
        disabled={busy}
        onPick={() => void pick(authority)}
      />
      {!linked && (
        <>
          <Text style={styles.muted}>
            Prepare, approve and apply the selected wallet’s member link first. The director resolution and authority
            document cover that exact link.
          </Text>
          {commonProblem && <Text style={styles.muted}>{commonProblem}</Text>}
          <Action
            label="Prepare selected wallet link"
            disabled={busy || !commands.canPrepare || !!commonProblem}
            onPress={() => void submit('link')}
          />
        </>
      )}
      {linked && <Text style={styles.muted}>The exact selected wallet is linked to this member.</Text>}
      {approvals.map((row) => (
        <Action
          key={row.uuid}
          label={`Use company wallet approval ${row.changeId}`}
          disabled={busy || walletApproval === row.changeId}
          onPress={() => setWalletApproval(row.changeId!)}
        />
      ))}
      <Field label="Shares to grant" value={shares} editable={!busy} keyboardType="number-pad" onChange={setShares} />
      <Field
        label="Terms dated on (YYYY-MM-DD)"
        accessibilityLabel="Terms dated on"
        value={termsOn}
        editable={!busy}
        onChange={setTermsOn}
      />
      <Field
        label="Non-paid grant terms"
        value={terms}
        editable={!busy}
        maxLength={1000}
        multiline
        onChange={setTerms}
      />
      <EvidencePicker
        title="Terms document"
        noun="terms document"
        evidence={termsDocument}
        disabled={busy}
        onPick={() => void pick(termsDocument)}
      />
      <Text style={styles.text}>
        Recipient acceptance:{' '}
        {acceptanceRequired === null
          ? 'Choose the requirement in these terms'
          : acceptanceRequired
            ? 'Required by these terms'
            : 'Not required by these terms'}
      </Text>
      <Action
        label="Terms require recipient acceptance"
        disabled={busy || acceptanceRequired === true}
        onPress={() => setAcceptanceRequired(true)}
      />
      <Action
        label="Terms do not require recipient acceptance"
        disabled={busy || acceptanceRequired === false}
        onPress={() => setAcceptanceRequired(false)}
      />
      {acceptanceRequired && (
        <EvidencePicker
          title="Acceptance document"
          noun="acceptance document"
          evidence={acceptance}
          disabled={busy}
          onPick={() => void pick(acceptance)}
        />
      )}
      {issueProblem && <Text style={styles.muted}>{issueProblem}</Text>}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        label={submitting ? 'Preparing…' : 'Prepare company grant'}
        primary
        disabled={busy || !commands.canPrepare || !!issueProblem || !!commands.recovery}
        onPress={() => void submit('issue')}
      />
    </View>
  );
}

export function CompanyIssueFlow({ uuid, data }: { uuid: string; data: Read }) {
  const styles = useCompanyStyles();
  const commands = useCompanyIssueInstructions(apiClient, uuid, {
    token: data.token.data,
    tokenKey: data.tokenKey,
    newKey: () => Crypto.randomUUID(),
    session: orderSubmissionSession,
  });
  const [draftOwner, setDraftOwner] = useState(commands.owner);
  useEffect(() => setDraftOwner(commands.owner), [commands.owner]);
  if (!commands.owner) return null;
  return (
    <Section title="Company non-paid grants">
      <Text style={styles.muted}>
        Company preparation and approval are separate from the original mint and register outcome.
      </Text>
      <Action label="Refresh company grant records" disabled={commands.busy} onPress={() => void commands.refresh()} />
      {!commands.visible && (
        <Text style={styles.muted}>
          Current personal register access for this company is required. Retained requests stay private until it is
          refreshed.
        </Text>
      )}
      {commands.visible && !commands.steps.prepare && (
        <Text style={styles.muted}>
          You can read company grant history. Preparation requires current company administration or prepare capability.
        </Text>
      )}
      {commands.visible && commands.instructions.isPending && (
        <Text style={styles.muted}>Loading company grant records…</Text>
      )}
      {commands.visible && commands.instructions.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          The grant records could not be refreshed. Retained original receipts remain available.
        </Text>
      )}
      {commands.visible &&
        (commands.nominations.isError ||
          commands.walletApprovals.isError ||
          commands.members.isError ||
          commands.links.isError) && (
          <Text accessibilityRole="alert" style={styles.error}>
            The selected company source records could not be refreshed. Refresh before a new decision.
          </Text>
        )}
      {draftOwner === commands.owner && (
        <View style={!commands.visible || !commands.steps.prepare ? { display: 'none' } : undefined}>
          <Preparation key={commands.scopeKey} commands={commands} />
        </View>
      )}
      {commands.visible && commands.recovery && (
        <View style={styles.group}>
          <Text style={styles.muted}>
            The original preparation response is unresolved. Recover its identical body and operation UUID.
          </Text>
          <Text selectable style={styles.text}>
            {commands.recovery.body.operationId}
          </Text>
          <Action
            label="Recover company preparation receipt"
            disabled={commands.busy}
            onPress={() => void commands.recover()}
          />
        </View>
      )}
      {commands.error && commands.visible && (
        <Text accessibilityRole="alert" style={styles.error}>
          {commands.error}
        </Text>
      )}
      <View style={!commands.visible ? { display: 'none' } : undefined}>
        {commands.linksRecords.map((record) => (
          <LinkRecord key={record.uuid} record={record} commands={commands} epoch={data.epoch} />
        ))}
        {commands.records.map((record) => (
          <IssueRecord key={record.uuid} record={record} commands={commands} epoch={data.epoch} />
        ))}
      </View>
    </Section>
  );
}

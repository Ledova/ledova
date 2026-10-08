import { useEffect, useRef, useState } from 'react';
import {
  useCompanyIssueInstructions,
  REGISTER_ISSUE_COPY as COPY,
  REGISTER_ISSUE_DECISIONS,
  REGISTER_ISSUE_UNMET_COPY,
  REGISTER_LINK_COPY,
  REGISTER_LINK_DECISIONS,
  isRegisterEvidenceReceipt,
  uploadRegisterEvidence,
  downloadRegisterIssueFile,
  downloadRegisterLinkFile,
  failureStatus,
  formatShareCount,
  formatDateTime,
  getErrorMessage,
  requestShares,
  registerIssueExecutionState,
  type RegisterEvidence,
  type RegisterIssue,
  type RegisterIssueSnapshot,
  type RegisterLink,
} from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { RegisterDecisions } from '../register/RegisterDecisions';
import { saveFile } from '../register/useCompanyRegister';
import { DecisionTrail } from '../register/DecisionTrail';
import type { useShareClass } from './useShareClass';

type Commands = ReturnType<typeof useCompanyIssueInstructions>;
type EvidenceKind = 'authority' | 'terms' | 'acceptance';
const stages: Record<string, string> = COPY.STAGES;

function SnapshotRows({ snapshot }: { snapshot: RegisterIssueSnapshot }) {
  return (
    <Rows>
      <Row label="Company">
        {snapshot.company.name} · ACN {snapshot.company.acn}
      </Row>
      <Row label="Share class">
        {snapshot.token.name} · {snapshot.token.symbol}
      </Row>
      <Row label="Member">
        {snapshot.member.name} · {snapshot.member.uuid}
      </Row>
      <Row label="Residential address">{snapshot.member.residentialAddress}</Row>
      <Row label="Identity source">{snapshot.member.identitySource}</Row>
      <Row label="Nominated wallet">{snapshot.wallet.address}</Row>
      <Row label="Nomination">{snapshot.wallet.nomination}</Row>
      <Row label="Company ADD">{snapshot.wallet.approval}</Row>
      <Row label="Approval expiry">{formatDateTime(snapshot.wallet.expiresAt)}</Row>
      <Row label="Proof completed">{formatDateTime(snapshot.wallet.proofCompletedAt)}</Row>
      <Row label="Eligibility expiry">{formatDateTime(snapshot.wallet.eligibilityExpiresAt)}</Row>
      <Row label="Register opening">{snapshot.register.opening}</Row>
      <Row label="Register sequence">{snapshot.register.sequence}</Row>
      <Row label="Register head">{snapshot.register.headHash}</Row>
      <Row label="Contract">{snapshot.token.contractAddress}</Row>
      <Row label="Technical sender">{snapshot.transaction.sender}</Row>
    </Rows>
  );
}

function IssueRecord({ record, commands }: { record: RegisterIssue; commands: Commands }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const download = async (kind: EvidenceKind) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      commands.guard();
      const response = await downloadRegisterIssueFile(apiClient, record.uuid, kind, commands.config(commands.guard));
      commands.guard();
      saveFile(response.data, `${kind}-${record.uuid}`);
    } catch (failure) {
      setError(
        getErrorMessage(failure, 'The retained copy could not be downloaded.') ?? 'The request could not be confirmed.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 border-t border-border py-4">
      {commands.visible && (
        <>
          <h3 className="font-medium">{stages[record.stage] ?? record.stage} non-paid grant</h3>
          <SnapshotRows snapshot={record.snapshot} />
          <Rows>
            <Row label="Shares">{formatShareCount(record.shares)}</Row>
            <Row label="Terms date">{record.termsOn}</Row>
            <Row label="Non-paid terms">{record.terms}</Row>
            <Row label="Approving director">{record.approvingDirector}</Row>
            <Row label="Authority reference">{record.authorityReference}</Row>
            <Row label="Reason">{record.reason}</Row>
            <Row label="Recipient acceptance">
              {record.acceptanceRequired ? 'Required; evidence retained' : 'Not required by these terms'}
            </Row>
            <Row label="Preparation ID">{record.uuid}</Row>
            <Row label="Original request">{record.request}</Row>
            <Row label="Intent fingerprint">{record.intentDigest}</Row>
            {record.approvalDecision && <Row label="Consumed approval">{record.approvalDecision}</Row>}
            <Row label="Execution">{registerIssueExecutionState(record)}</Row>
            {record.execution && (
              <>
                <Row label="Original execution">{record.execution.execution}</Row>
                <Row label="Dispatch">{record.execution.dispatchId}</Row>
                {record.execution.operationId && <Row label="Execution operation">{record.execution.operationId}</Row>}
                {record.execution.txHash && <Row label="Transaction hash">{record.execution.txHash}</Row>}
                {record.execution.registerEntry && <Row label="Register entry">{record.execution.registerEntry}</Row>}
                {record.execution.effectiveOn && <Row label="Register entry date">{record.execution.effectiveOn}</Row>}
              </>
            )}
          </Rows>
          <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
          <DecisionTrail proposal={record} labels={COPY.DECISIONS} />
          {record.status === 'applied' && <p className="text-sm text-text-muted">{COPY.ADMITTED_NOTE}</p>}
          {record.executionUnmetRequirements.map((code) => (
            <p key={code} className="text-sm text-text-muted">
              {REGISTER_ISSUE_UNMET_COPY[code] ?? code}
            </p>
          ))}
          <div className="flex flex-wrap gap-2">
            {(['authority', 'terms', ...(record.acceptanceEvidence ? ['acceptance'] : [])] as EvidenceKind[]).map(
              (kind) => (
                <PageAction
                  key={kind}
                  label={`Download ${kind} document`}
                  context={`grant ${record.uuid}`}
                  disabled={busy}
                  onClick={() => void download(kind)}
                />
              ),
            )}
          </div>
          {error && <p role="alert">{error}</p>}
        </>
      )}
      <RegisterDecisions
        family={REGISTER_ISSUE_DECISIONS}
        copy={COPY}
        noun="non-paid grant"
        proposal={record}
        steps={commands.steps}
        guard={commands.guard}
        newEffectGuard={(kind) => commands.guardIssue(kind, record)}
        onDecided={commands.accept}
        onRefused={commands.refresh}
        visible={commands.visible}
        context={`grant ${record.uuid}`}
      >
        {(preview) => (
          <>
            <SnapshotRows snapshot={preview.snapshot} />
            <Rows>
              <Row label="Shares">{formatShareCount(preview.shares)}</Row>
              <Row label="Terms date">{preview.termsOn}</Row>
              <Row label="Non-paid terms">{preview.terms}</Row>
              <Row label="Approving director">{preview.approvingDirector}</Row>
              <Row label="Authority reference">{preview.authorityReference}</Row>
              <Row label="Recipient acceptance">
                {preview.acceptanceRequired ? 'Required; evidence retained' : 'Not required by these terms'}
              </Row>
              <Row label="Member holding">
                {formatShareCount(preview.currentShares)} → {formatShareCount(preview.afterShares)}
              </Row>
              <Row label="Issued supply">
                {formatShareCount(preview.issuedSupply)} → {formatShareCount(preview.afterIssuedSupply)}
              </Row>
              <Row label="Reserved shares">{formatShareCount(preview.reservedShares)}</Row>
              <Row label="Available shares">{formatShareCount(preview.availableShares)}</Row>
              <Row label="Authorised supply">{formatShareCount(preview.authorisedSupply)}</Row>
            </Rows>
            <p className="text-sm text-text-muted">{COPY.ADMITTED_NOTE}</p>
          </>
        )}
      </RegisterDecisions>
    </div>
  );
}

function LinkRecord({ record, commands }: { record: RegisterLink; commands: Commands }) {
  const [error, setError] = useState('');
  const download = async () => {
    try {
      commands.guard();
      const response = await downloadRegisterLinkFile(apiClient, record.uuid, commands.config(commands.guard));
      commands.guard();
      saveFile(response.data, `authority-${record.uuid}`);
    } catch (failure) {
      setError(
        getErrorMessage(failure, 'The retained authority copy could not be downloaded.') ??
          'The request could not be confirmed.',
      );
    }
  };
  return (
    <div className="space-y-3 border-t border-border py-4">
      {commands.visible && (
        <>
          <h3 className="font-medium">{REGISTER_LINK_COPY.STAGES[record.stage] ?? record.stage} wallet link</h3>
          <Rows>
            {record.mapping.map((row) => (
              <Row key={row.address} label="Documented link">
                {row.address} → {row.member}
              </Row>
            ))}
            <Row label="Authority reference">{record.authorityReference}</Row>
            <Row label="Approving director">{record.approvingDirector}</Row>
            <Row label="Reason">{record.reason}</Row>
            <Row label="Link preparation">{record.uuid}</Row>
          </Rows>
          <DecisionTrail proposal={record} labels={REGISTER_LINK_COPY.DECISIONS} />
          <PageAction label="Download link authority" context={`link ${record.uuid}`} onClick={() => void download()} />
          {error && <p role="alert">{error}</p>}
        </>
      )}
      <RegisterDecisions
        family={REGISTER_LINK_DECISIONS}
        copy={REGISTER_LINK_COPY}
        noun="wallet link"
        proposal={record}
        steps={commands.steps}
        guard={commands.guard}
        newEffectGuard={(kind) => commands.guardLink(kind, record)}
        onDecided={commands.acceptLink}
        onRefused={commands.refresh}
        visible={commands.visible}
        context={`link ${record.uuid}`}
      >
        {(preview) => (
          <>
            <Rows>
              {preview.links.map((row) => (
                <Row key={row.address} label="Documented link">
                  {row.address} → {row.member} · {row.holderName ?? 'Identity unavailable'}
                </Row>
              ))}
            </Rows>
            <p className="text-sm text-text-muted">{REGISTER_LINK_COPY.APPLY_NOTE}</p>
          </>
        )}
      </RegisterDecisions>
    </div>
  );
}

function Preparation({ commands }: { commands: Commands }) {
  const [nomination, setNomination] = useState('');
  const [member, setMember] = useState('new');
  const [newMember] = useState(() => crypto.randomUUID());
  const [approval, setApproval] = useState('');
  const [director, setDirector] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [shares, setShares] = useState('');
  const [termsOn, setTermsOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [terms, setTerms] = useState('');
  const [acceptanceRequired, setAcceptanceRequired] = useState(false);
  const [files, setFiles] = useState<Partial<Record<EvidenceKind, File>>>({});
  const uploads = useRef<
    Partial<Record<EvidenceKind, { file: File; appointment: string; key: string; receipt: RegisterEvidence | null }>>
  >({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const chosen = commands.nominations.data?.find((row) => row.uuid === nomination);
  const selectedMember = member === 'new' ? newMember : member;
  const approvals = (commands.walletApprovals.data ?? []).filter(
    (row) =>
      row.action === 'add' &&
      row.nomination === nomination &&
      row.changeId &&
      ['confirmed', 'unchanged'].includes(row.execution?.status ?? ''),
  );
  const appliedNewLink =
    chosen &&
    commands.linksRecords.some(
      (link) =>
        link.status === 'applied' &&
        link.mapping.some(
          (row) => row.member === newMember && row.address.toLowerCase() === chosen.address.toLowerCase(),
        ),
    );
  const displayedMember = member === 'new' && appliedNewLink ? newMember : member;
  const waiting = busy || commands.busy;
  const commonProblem = !chosen || !director.trim() || !reference.trim() || !reason.trim() || !files.authority;
  const issueProblem =
    commonProblem ||
    displayedMember === 'new' ||
    !approval ||
    requestShares(shares) === null ||
    !/^\d{4}-\d{2}-\d{2}$/.test(termsOn) ||
    termsOn > new Date().toISOString().slice(0, 10) ||
    !terms.trim() ||
    !files.terms ||
    (acceptanceRequired && !files.acceptance);
  const submit = async (kind: 'link' | 'issue') => {
    if (waiting || !commands.canPrepare || commands.recovery || (kind === 'link' ? commonProblem : issueProblem))
      return;
    setBusy(true);
    setError('');
    const mapping = [{ address: chosen!.address, member: selectedMember }];
    const check = () => {
      if (!mounted.current) throw new Error('This grant form is closed.');
      if (kind === 'link') commands.guardLink('prepare', { mapping, nomination });
      else commands.guardIssue('prepare', { member: selectedMember, nomination, walletApproval: approval });
    };
    const upload = async (slot: EvidenceKind) => {
      check();
      const file = files[slot]!;
      const appointment = commands.steps.prepare!.uuid;
      const prior = uploads.current[slot];
      const same = prior?.file === file && prior.appointment === appointment;
      if (same && prior.receipt) return prior.receipt;
      const key = same ? prior.key : crypto.randomUUID();
      uploads.current[slot] = { file, appointment, key, receipt: null };
      const request = {
        companyId: commands.company,
        appointment,
        kind: slot === 'authority' ? ('authority' as const) : ('supporting' as const),
        idempotencyKey: key,
      };
      const response = await uploadRegisterEvidence(apiClient, { ...request, file }, commands.config(check));
      check();
      if (!isRegisterEvidenceReceipt(response.data, request, file.size))
        throw new Error('The exact evidence receipt could not be confirmed.');
      uploads.current[slot] = { file, appointment, key, receipt: response.data };
      return response.data;
    };
    try {
      const authority = await upload('authority');
      if (kind === 'link')
        await commands.sendLink(
          {
            authorityEvidence: authority.uuid,
            mapping,
            authority: 'director_resolution',
            approvingDirector: director.trim(),
            authorityReference: reference.trim(),
            reason: reason.trim(),
          },
          nomination,
        );
      else {
        const retainedTerms = await upload('terms');
        const acceptance = acceptanceRequired ? await upload('acceptance') : null;
        await commands.sendIssue({
          member: selectedMember,
          nomination,
          walletApproval: approval,
          shares,
          termsOn,
          terms: terms.trim(),
          approvingDirector: director.trim(),
          authorityReference: reference.trim(),
          reason: reason.trim(),
          authorityEvidence: authority.uuid,
          termsEvidence: retainedTerms.uuid,
          acceptanceRequired,
          acceptanceEvidence: acceptance?.uuid ?? null,
        });
      }
    } catch (failure) {
      if (failureStatus(failure) === 409) uploads.current = {};
      if (mounted.current)
        setError(getErrorMessage(failure, 'The grant could not be prepared.') ?? 'The request could not be confirmed.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  if (!commands.visible || !commands.steps.prepare) return null;
  return (
    <fieldset disabled={waiting} className="space-y-4">
      <label className="block text-sm">
        Nominated wallet
        <select
          className={FIELD_CLASS}
          value={nomination}
          onChange={(event) => {
            setNomination(event.target.value);
            setApproval('');
          }}
        >
          <option value="">Select a wallet explicitly shared with this company</option>
          {(commands.nominations.data ?? []).map((row) => (
            <option key={row.uuid} value={row.uuid}>
              {row.address}
            </option>
          ))}
        </select>
      </label>
      {chosen && (
        <Rows>
          <Row label="Nomination">{chosen.uuid}</Row>
          <Row label="Proof completed">{formatDateTime(chosen.proofCompletedAt)}</Row>
          <Row label="Eligibility expiry">{formatDateTime(chosen.eligibilityExpiresAt)}</Row>
        </Rows>
      )}
      <label className="block text-sm">
        Member
        <select className={FIELD_CLASS} value={displayedMember} onChange={(event) => setMember(event.target.value)}>
          <option value="new">Create a new member through the documentary link</option>
          {(commands.members.data?.members ?? []).map((row) => (
            <option key={row.member} value={row.member}>
              {row.name ?? 'Identity shown in grant preview'} · {row.member} · {formatShareCount(row.currentShares)}{' '}
              shares
            </option>
          ))}
        </select>
      </label>
      {member === 'new' && <p className="text-sm text-text-muted">New stable member: {newMember}</p>}
      <label className="block text-sm">
        Approving director
        <input className={FIELD_CLASS} value={director} onChange={(event) => setDirector(event.target.value)} />
      </label>
      <label className="block text-sm">
        Authority reference
        <input className={FIELD_CLASS} value={reference} onChange={(event) => setReference(event.target.value)} />
      </label>
      <label className="block text-sm">
        Reason
        <input className={FIELD_CLASS} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <label className="block text-sm">
        Authority document
        <input
          type="file"
          accept="application/pdf,image/*"
          onChange={(event) => setFiles({ ...files, authority: event.target.files?.[0] })}
        />
      </label>
      <p className="text-sm text-text-muted">
        Apply the company documentary link before preparing the grant. It records this nominated address against the
        chosen stable member.
      </p>
      <PageAction
        label="Prepare nominated wallet link"
        disabled={waiting || !commands.canPrepare || !!commonProblem || !!commands.recovery}
        onClick={() => void submit('link')}
      />
      <label className="block text-sm">
        Company ADD
        <select className={FIELD_CLASS} value={approval} onChange={(event) => setApproval(event.target.value)}>
          <option value="">Select the genuine successful ADD for this nomination</option>
          {approvals.map((row) => (
            <option key={row.uuid} value={row.changeId!}>
              {row.changeId} · {formatDateTime(row.expiresAt)}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Shares to grant
        <input
          inputMode="numeric"
          className={FIELD_CLASS}
          value={shares}
          onChange={(event) => setShares(event.target.value)}
        />
      </label>
      <p className="text-xs text-text-muted">Enter whole shares from 1 to 2,147,483,647.</p>
      <label className="block text-sm">
        Terms date
        <input
          type="date"
          className={FIELD_CLASS}
          value={termsOn}
          onChange={(event) => setTermsOn(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        Non-paid terms
        <textarea className={FIELD_CLASS} value={terms} onChange={(event) => setTerms(event.target.value)} />
      </label>
      <label className="block text-sm">
        Terms document
        <input
          type="file"
          accept="application/pdf,image/*"
          onChange={(event) => setFiles({ ...files, terms: event.target.files?.[0] })}
        />
      </label>
      <label className="flex gap-2 text-sm">
        <input
          type="checkbox"
          checked={acceptanceRequired}
          onChange={(event) => setAcceptanceRequired(event.target.checked)}
        />
        Recipient acceptance required by these terms
      </label>
      {acceptanceRequired && (
        <label className="block text-sm">
          Acceptance document
          <input
            type="file"
            accept="application/pdf,image/*"
            onChange={(event) => setFiles({ ...files, acceptance: event.target.files?.[0] })}
          />
        </label>
      )}
      <PageAction
        label={COPY.PREPARE}
        disabled={waiting || !commands.canPrepare || !!issueProblem || !!commands.recovery}
        onClick={() => void submit('issue')}
      />
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}

export function CompanyIssueFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useShareClass> }) {
  const commands = useCompanyIssueInstructions(apiClient, uuid, {
    token: data.token.data,
    tokenKey: data.tokenKey,
    newKey: () => crypto.randomUUID(),
  });
  const [refreshError, setRefreshError] = useState('');
  const refresh = async () => {
    setRefreshError('');
    try {
      await commands.refresh();
    } catch (failure) {
      setRefreshError(
        getErrorMessage(failure, 'Current company records could not be refreshed.') ??
          'The request could not be confirmed.',
      );
    }
  };
  if (!commands.owner) return null;
  return (
    <Section title={COPY.TITLE}>
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
      <PageAction label="Refresh company grant records" disabled={commands.busy} onClick={() => void refresh()} />
      {refreshError && <p role="alert">{refreshError}</p>}
      {!commands.visible && (
        <p className="text-sm text-text-muted">Current personal register read access is required.</p>
      )}
      <Preparation key={commands.scopeKey} commands={commands} />
      {commands.visible && commands.recovery && (
        <>
          <p className="text-sm text-text-muted">
            The original {commands.recovery.kind} preparation is uncertain. Recover its identical body and operation
            UUID: {commands.recovery.body.operationId}
          </p>
          <PageAction
            label="Recover original preparation receipt"
            disabled={commands.busy}
            onClick={() => void commands.recover()}
          />
        </>
      )}
      {commands.visible && commands.error && <p role="alert">{commands.error}</p>}
      {commands.linksRecords.map((record) => (
        <LinkRecord key={record.uuid} record={record} commands={commands} />
      ))}
      {commands.records.map((record) => (
        <IssueRecord key={record.uuid} record={record} commands={commands} />
      ))}
      {commands.visible &&
        (commands.instructions.isError ||
          commands.members.isError ||
          commands.nominations.isError ||
          commands.walletApprovals.isError ||
          commands.links.isError) && (
          <p role="alert">
            Current grant sources or history could not be refreshed. Retained original receipts are kept.
          </p>
        )}
    </Section>
  );
}

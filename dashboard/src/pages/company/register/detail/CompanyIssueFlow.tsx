import { SelectField } from '@components/SelectField';
import { Row, Rows, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import { SearchSelect } from '@components/SearchSelect';
import {
  REGISTER_ISSUE_COPY as COPY,
  REGISTER_ISSUE_DECISIONS,
  REGISTER_ISSUE_UNMET_COPY,
  REGISTER_LINK_COPY,
  REGISTER_LINK_DECISIONS,
  formatDateTime,
  formatShareCount,
  peopleFrom,
  personChoices,
  registerIssueExecutionState,
  useCompanyIssueInstructions,
  type RegisterIssue,
  type RegisterIssueSnapshot,
  type RegisterLink,
  refusalSentences,
  failureSentence,
  utcToday,
} from '@ledova/shared';
import { DecisionTrail } from '@pages/company/register/shared/DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { useMemo, useState } from 'react';
import {
  useIssueLinkRecord,
  useIssuePreparation,
  useIssueRecord,
  type Commands,
  type EvidenceKind,
} from './useCompanyIssueFlow';
import type { useShareClass } from './useShareClass';

const stages: Record<string, string> = COPY.STAGES;

const NEW_MEMBER = [{ value: 'new', label: 'Create a new member through the documentary link' }];
const MEMBERS = ['member', 'members'] as const;
const WALLETS = ['wallet', 'wallets'] as const;

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
  const { error, busy, download } = useIssueRecord({ record, commands });
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
          {refusalSentences(record.executionUnmetRequirements, REGISTER_ISSUE_UNMET_COPY).map((sentence) => (
            <p key={sentence} className="text-sm text-text-muted">
              {sentence}
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
  const { error, download } = useIssueLinkRecord({ record, commands });
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
  const {
    nomination,
    setNomination,
    member,
    setMember,
    newMember,
    approval,
    setApproval,
    director,
    setDirector,
    reference,
    setReference,
    reason,
    setReason,
    shares,
    setShares,
    termsOn,
    setTermsOn,
    terms,
    setTerms,
    acceptanceRequired,
    setAcceptanceRequired,
    files,
    setFiles,
    error,
    chosen,
    approvals,
    displayedMember,
    waiting,
    preparing,
    commonProblem,
    issueProblem,
    submit,
  } = useIssuePreparation({ commands });
  const memberChoices = useMemo(
    () =>
      personChoices(
        peopleFrom(commands.members.data).filter((person) => !person.awardOnly),
        (person) => `${formatShareCount(person.currentShares)} shares`,
      ),
    [commands.members.data],
  );
  if (!commands.visible || !commands.steps.prepare) return null;
  return (
    <fieldset
      disabled={waiting}
      className="grid gap-4 rounded-xl border border-border-subtle bg-surface-tertiary p-4 sm:grid-cols-2 [&>p]:sm:col-span-2 [&>h3]:sm:col-span-2 [&>dl]:sm:col-span-2"
    >
      <SearchSelect
        label="Nominated wallet"
        choices={(commands.nominations.data ?? []).map((row) => ({
          value: row.uuid,
          label: row.address,
          detail: `Proof completed ${formatDateTime(row.proofCompletedAt)}`,
        }))}
        value={nomination}
        onChange={(uuid) => {
          setNomination(uuid);
          setApproval('');
        }}
        placeholder="Type part of a wallet address"
        noun={WALLETS}
      />
      {chosen && (
        <Rows>
          <Row label="Nomination">{chosen.uuid}</Row>
          <Row label="Proof completed">{formatDateTime(chosen.proofCompletedAt)}</Row>
          <Row label="Eligibility expiry">{formatDateTime(chosen.eligibilityExpiresAt)}</Row>
        </Rows>
      )}
      <SearchSelect
        label="Member"
        choices={memberChoices}
        first={NEW_MEMBER}
        value={displayedMember}
        onChange={setMember}
        noun={MEMBERS}
      />
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
        busy={preparing === 'link'}
        busyLabel="Preparing wallet link…"
        disabled={waiting || !commands.canPrepare || !!commonProblem || !!commands.recovery}
        onClick={() => void submit('link')}
      />
      <SelectField
        label="Company ADD"
        options={[
          { value: '', label: 'Select the genuine successful ADD for this nomination' },
          ...approvals.map((row) => ({
            value: row.changeId!,
            label: `Admitted ${formatDateTime(row.reviewedAt)} · ${
              row.expiresAt ? `until ${formatDateTime(row.expiresAt)}` : 'without an expiry'
            }`,
            reference: row.changeId!.slice(0, 8),
          })),
        ]}
        value={approval}
        onChange={setApproval}
      />
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
        Terms date (UTC)
        <input
          type="date"
          max={utcToday()}
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
        primary
        label={COPY.PREPARE}
        busy={preparing === 'issue'}
        busyLabel="Preparing non-paid grant…"
        disabled={waiting || !commands.canPrepare || !!issueProblem || !!commands.recovery}
        onClick={() => void submit('issue')}
      />
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}

export function CompanyIssueFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useShareClass> }) {
  const commands = useCompanyIssueInstructions(uuid, {
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
      setRefreshError(failureSentence(failure, 'Current company records could not be refreshed.'));
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

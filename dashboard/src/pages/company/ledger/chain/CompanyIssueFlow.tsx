import { useEntryReads } from '@hooks/useEntryReads';
import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { SelectField } from '@components/SelectField';
import { Row, Rows, Section, LoadError, Loading } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { SearchSelect } from '@components/SearchSelect';
import {
  FIELD_LIMITS,
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
  formatDate,
  shareCount,
  shortReference,
  IDENTITY_SOURCE_LABELS,
} from '@ledova/shared';
import { DecisionTrail } from '@pages/company/ledger/shared/DecisionTrail';
import { RecordShell, RecordStage } from '@pages/company/ledger/shared/RecordShell';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LINK_FIELDS,
  useIssueLinkRecord,
  useIssuePreparation,
  useIssueRecord,
  type Commands,
  type EvidenceKind,
} from './useCompanyIssueFlow';
import { PreparationSlot } from './PreparationSlot';
import { TransactionRow } from '@pages/company/shared/TransactionRow';
import type { useShareClass } from '@pages/company/ledger/shared/useShareClass';

const stages: Record<string, string> = COPY.STAGES;

const NEW_MEMBER = [{ value: 'new', label: 'New member' }];
const MEMBERS = ['member', 'members'] as const;
const WALLETS = ['wallet', 'wallets'] as const;

function linkedMember(row: { member: string; memberExists: boolean }, names: ReadonlyMap<string, string>) {
  return names.get(row.member) || (row.memberExists ? `Member ${shortReference(row.member)}` : 'New member');
}

function MemberRows({ snapshot }: { snapshot: RegisterIssueSnapshot }) {
  return (
    <>
      <Row label="Member">{snapshot.member.name}</Row>
      <Row label="Residential address">{snapshot.member.residentialAddress}</Row>
      <Row label="Identity source">{IDENTITY_SOURCE_LABELS[snapshot.member.identitySource] ?? 'Not identified'}</Row>
      <Row label="Nominated wallet">{snapshot.wallet.address}</Row>
      <Row label="Proof completed">{formatDateTime(snapshot.wallet.proofCompletedAt)}</Row>
      <Row label="Wallet approval expiry">{formatDateTime(snapshot.wallet.expiresAt)}</Row>
      <Row label="Eligibility expiry">{formatDateTime(snapshot.wallet.eligibilityExpiresAt)}</Row>
    </>
  );
}

function IssueRecord({
  record,
  chain,
  commands,
  onHeldChange,
}: {
  record: RegisterIssue;
  chain: string | null | undefined;
  commands: Commands;
  onHeldChange: (uuid: string, held: boolean) => void;
}) {
  const { error, downloading, download } = useIssueRecord({ record, commands });
  const context = `non-paid grant for ${record.snapshot.member.name} prepared ${formatDateTime(record.createdAt)}`;
  return (
    <RecordShell hidden={!commands.visible}>
      {commands.visible && (
        <>
          <h3 className="font-medium">Non-paid grant to {record.snapshot.member.name}</h3>
          <Rows>
            <RecordStage stage={record.stage}>{stages[record.stage] ?? record.stage}</RecordStage>
            <MemberRows snapshot={record.snapshot} />
            <Row label="Shares">{formatShareCount(record.shares)}</Row>
            <Row label="Terms date">{formatDate(record.termsOn, 'Not recorded')}</Row>
            <Row label="Non-paid terms">{record.terms}</Row>
            <Row label="Approving director">{record.approvingDirector}</Row>
            <Row label="Authority reference">{record.authorityReference}</Row>
            <Row label="Reason">{record.reason}</Row>
            <Row label="Recipient acceptance">
              {record.acceptanceRequired ? 'Required; evidence retained' : 'Not required by these terms'}
            </Row>
            <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>
            <DecisionTrail proposal={record} labels={COPY.DECISIONS} />
            <Row label="Execution">{registerIssueExecutionState(record)}</Row>
            {record.execution?.txHash && <TransactionRow chain={chain} hash={record.execution.txHash} />}
            {record.execution?.effectiveOn && (
              <Row label="Register entry date">{formatDate(record.execution.effectiveOn)}</Row>
            )}
          </Rows>
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
                  context={context}
                  disabled={!!downloading}
                  busy={downloading === kind}
                  busyLabel="Downloading…"
                  onClick={() => void download(kind)}
                />
              ),
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-error-light">
              {error}
            </p>
          )}
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
        onHeldChange={onHeldChange}
        context={context}
      >
        {(preview) => (
          <>
            <p className="text-sm text-text-muted">
              {preview.snapshot.token.name} · {preview.snapshot.token.symbol}
            </p>
            <Rows>
              <MemberRows snapshot={preview.snapshot} />
              <Row label="Shares">{formatShareCount(preview.shares)}</Row>
              <Row label="Terms date">{formatDate(preview.termsOn)}</Row>
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
    </RecordShell>
  );
}

function LinkRecord({
  record,
  commands,
  onHeldChange,
}: {
  record: RegisterLink;
  commands: Commands;
  onHeldChange: (uuid: string, held: boolean) => void;
}) {
  const { error, busy, download } = useIssueLinkRecord({ record, commands });
  const names = useMemo(
    () => new Map(peopleFrom(commands.members.data).map((person) => [person.member, person.name])),
    [commands.members.data],
  );
  const context = `wallet link prepared ${formatDateTime(record.createdAt)}`;
  return (
    <RecordShell hidden={!commands.visible}>
      {commands.visible && (
        <>
          <h3 className="font-medium">Wallet link</h3>
          <Rows>
            <RecordStage stage={record.stage}>{REGISTER_LINK_COPY.STAGES[record.stage] ?? record.stage}</RecordStage>
            {record.mappingSummary.map((row) => (
              <Row key={row.address} label="Linked wallet">
                <span className="break-all">{row.address}</span> → {linkedMember(row, names)}
              </Row>
            ))}
            <Row label="Authority reference">{record.authorityReference}</Row>
            <Row label="Approving director">{record.approvingDirector}</Row>
            <Row label="Reason">{record.reason}</Row>
            <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>
            <DecisionTrail proposal={record} labels={REGISTER_LINK_COPY.DECISIONS} />
          </Rows>
          <PageAction
            label="Download link authority"
            context={context}
            busy={busy}
            busyLabel="Downloading…"
            onClick={() => void download()}
          />
          {error && (
            <p role="alert" className="text-sm text-error-light">
              {error}
            </p>
          )}
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
        onHeldChange={onHeldChange}
        context={context}
      >
        {(preview) => (
          <>
            <Rows>
              {preview.links.map((row) => (
                <Row key={row.address} label="Linked wallet">
                  <span className="break-all">{row.address}</span> → {linkedMember(row, names)}
                  {row.holderName && <span className="block text-text-muted">Wallet holder: {row.holderName}</span>}
                </Row>
              ))}
            </Rows>
            <p className="text-sm text-text-muted">{REGISTER_LINK_COPY.APPLY_NOTE}</p>
          </>
        )}
      </RegisterDecisions>
    </RecordShell>
  );
}

function Preparation({
  commands,
  onEditingChange,
  onCancel,
}: {
  commands: Commands;
  onEditingChange: (held: boolean) => void;
  onCancel: () => void;
}) {
  const {
    draft,
    nomination,
    setNomination,
    member,
    setMember,
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
    problems,
    submit,
  } = useIssuePreparation({ commands });
  const checks = useErrorSummary(problems);
  useEffect(() => {
    onEditingChange(draft.active);
    return () => onEditingChange(false);
  }, [draft, onEditingChange]);
  const memberChoices = useMemo(
    () =>
      personChoices(
        peopleFrom(commands.members.data).filter((person) => !person.awardOnly),
        (person) => shareCount(person.currentShares),
      ),
    [commands.members.data],
  );
  return (
    <fieldset
      disabled={waiting}
      className="grid min-w-0 gap-4 border-t border-border-subtle pt-4 sm:grid-cols-2 [&>*]:min-w-0 [&>p]:sm:col-span-2 [&>h3]:sm:col-span-2 [&>dl]:sm:col-span-2"
    >
      <h3 className="font-medium">Prepare a non-paid grant</h3>
      <ErrorSummary {...checks.summary} className="sm:col-span-2" />
      <SearchSelect
        {...checks.field('nomination')}
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
          <Row label="Proof completed">{formatDateTime(chosen.proofCompletedAt)}</Row>
          <Row label="Eligibility expiry">{formatDateTime(chosen.eligibilityExpiresAt)}</Row>
        </Rows>
      )}
      <SearchSelect
        {...checks.field('member')}
        label="Member"
        choices={memberChoices}
        first={NEW_MEMBER}
        value={displayedMember}
        onChange={setMember}
        noun={MEMBERS}
      />
      {member === 'new' && (
        <p className="text-sm text-text-muted">The wallet link creates this new member when it is applied.</p>
      )}
      <Field {...checks.field('director')} label="Approving director">
        <TextInput
          maxLength={FIELD_LIMITS.DIRECTOR}
          value={director}
          onChange={(event) => setDirector(event.target.value)}
        />
      </Field>
      <Field {...checks.field('reference')} label="Authority reference">
        <TextInput
          maxLength={FIELD_LIMITS.REFERENCE}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </Field>
      <Field {...checks.field('reason')} label="Reason" className="sm:col-span-2">
        <TextInput maxLength={FIELD_LIMITS.REASON} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <FileField
        showUploadHint={false}
        {...checks.field('authorityDocument')}
        label="Authority document"
        onFile={(file) => setFiles({ ...files, authority: file ?? undefined })}
      />
      <p className="text-sm text-text-muted">
        Prepare the wallet link and have it applied before preparing the grant. It records this wallet against the
        chosen member.
      </p>
      <div className="sm:col-span-2">
        <FormActions>
          <PageAction
            label="Prepare wallet link"
            busy={preparing === 'link'}
            busyLabel="Preparing wallet link…"
            disabled={waiting || !commands.canPrepare || !!commands.recovery}
            onClick={() => {
              if (checks.check(LINK_FIELDS)) void submit('link');
            }}
          />
        </FormActions>
      </div>
      <SelectField
        {...checks.field('approval')}
        label="Company wallet approval"
        options={[
          { value: '', label: "Choose the company's approval for this wallet" },
          ...approvals.map((row) => ({
            value: row.changeId!,
            label: `Admitted ${formatDateTime(row.reviewedAt)} · ${
              row.expiresAt ? `until ${formatDateTime(row.expiresAt)}` : 'without an expiry'
            }`,
            reference: shortReference(row.changeId!),
          })),
        ]}
        value={approval}
        onChange={setApproval}
      />
      <Field {...checks.field('shares')} label="Shares to grant" hint="Enter whole shares from 1 to 2,147,483,647.">
        <TextInput
          maxLength={FIELD_LIMITS.WHOLE_SHARES}
          inputMode="numeric"
          value={shares}
          onChange={(event) => setShares(event.target.value)}
        />
      </Field>
      <Field {...checks.field('termsOn')} label="Terms date (UTC)">
        <TextInput type="date" max={utcToday()} value={termsOn} onChange={(event) => setTermsOn(event.target.value)} />
      </Field>
      <Field {...checks.field('terms')} label="Non-paid terms" className="sm:col-span-2">
        <TextArea maxLength={FIELD_LIMITS.TERMS} value={terms} onChange={(event) => setTerms(event.target.value)} />
      </Field>
      <FileField
        showUploadHint={false}
        {...checks.field('termsDocument')}
        label="Terms document"
        onFile={(file) => setFiles({ ...files, terms: file ?? undefined })}
      />
      <label className="flex gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          checked={acceptanceRequired}
          onChange={(event) => setAcceptanceRequired(event.target.checked)}
        />
        Recipient acceptance required by these terms
      </label>
      {acceptanceRequired && (
        <FileField
          showUploadHint={false}
          {...checks.field('acceptanceDocument')}
          label="Acceptance document"
          onFile={(file) => setFiles({ ...files, acceptance: file ?? undefined })}
        />
      )}
      <div className="sm:col-span-2">
        <FormActions>
          <PageAction label="Cancel" disabled={waiting} onClick={onCancel} />
          <PageAction
            primary
            label={COPY.PREPARE}
            busy={preparing === 'issue'}
            busyLabel="Preparing non-paid grant…"
            disabled={waiting || !commands.canPrepare || !!commands.recovery}
            onClick={() => {
              if (checks.check()) void submit('issue');
            }}
          />
        </FormActions>
      </div>
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export function CompanyIssueFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useShareClass> }) {
  const [preparingGrant, setPreparingGrant] = useState(false);
  const onEditingChange = useCallback((held: boolean) => data.holdReads('issue/draft', held), [data.holdReads]);
  const onHeldChange = useCallback(
    (uuid: string, held: boolean) => data.holdReads('issue/decision/' + uuid, held),
    [data.holdReads],
  );
  const commands = useCompanyIssueInstructions(uuid, {
    token: data.token.data,
    tokenKey: data.tokenKey,
    newKey: () => crypto.randomUUID(),
    coordinatedReads: true,
    paused: data.readingPaused,
    onPrepared: (kind) => {
      if (kind !== 'issue') return;
      onEditingChange(false);
      setPreparingGrant(false);
    },
  });
  useEffect(() => {
    data.holdReads('issue/request', commands.working || !!commands.recovery);
    return () => data.holdReads('issue/request', false);
  }, [commands.working, commands.recovery, data.holdReads]);
  useEntryReads({
    scope: commands.owner ? data.scopeKey + '/issue' : null,
    paused: data.readingPaused || commands.readingPaused,
    refresh: commands.refresh,
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
  const token = data.token.data;
  const readFailed =
    commands.visible &&
    (commands.instructions.isError ||
      commands.members.isError ||
      commands.nominations.isError ||
      commands.walletApprovals.isError ||
      commands.links.isError);
  const reading =
    commands.instructions.isFetching ||
    commands.appointments.isFetching ||
    commands.members.isFetching ||
    commands.nominations.isFetching ||
    commands.walletApprovals.isFetching ||
    commands.links.isFetching;
  return (
    <Section title={COPY.TITLE}>
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
      {refreshError && <p role="alert">{refreshError}</p>}
      {commands.appointments.isError ? (
        <LoadError retry={refresh} busy={reading}>
          Your appointments could not be loaded.
        </LoadError>
      ) : !commands.appointments.isSuccess || commands.appointments.isFetching ? (
        <Loading>Loading your appointments…</Loading>
      ) : (
        !commands.visible && (
          <p className="text-sm text-text-muted">Current personal register read access is required.</p>
        )
      )}
      {commands.visible && commands.records.length + commands.linksRecords.length > 0 && (
        <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
      )}
      {commands.records.length + commands.linksRecords.length > 0 && (
        <ul hidden={!commands.visible} className="divide-y divide-border-subtle">
          {commands.linksRecords.map((record) => (
            <LinkRecord key={record.uuid} record={record} commands={commands} onHeldChange={onHeldChange} />
          ))}
          {commands.records.map((record) => (
            <IssueRecord
              key={record.uuid}
              record={record}
              chain={token?.chain}
              commands={commands}
              onHeldChange={onHeldChange}
            />
          ))}
        </ul>
      )}
      {commands.visible && commands.recovery && (
        <>
          <p className="text-sm text-text-muted">
            The original {commands.recovery.kind === 'link' ? 'wallet link' : 'share issue'} preparation is uncertain.
            Recover it with its identical original request.
          </p>
          <PageAction
            label="Recover original preparation receipt"
            disabled={commands.busy}
            onClick={() => void commands.recover()}
          />
        </>
      )}
      {commands.visible && commands.error && <p role="alert">{commands.error}</p>}
      {readFailed && (
        <LoadError retry={refresh} busy={reading}>
          Current grant sources or history could not be {commands.instructions.data ? 'refreshed' : 'loaded'}. Retained
          original receipts are kept.
        </LoadError>
      )}
      <PreparationSlot
        label={COPY.PREPARE}
        open={preparingGrant}
        available={commands.visible && !!commands.steps.prepare}
        disabled={!commands.canPrepare}
        hidden={!commands.visible || !commands.steps.prepare}
        onOpen={() => setPreparingGrant(true)}
      >
        <Preparation
          key={commands.scopeKey}
          commands={commands}
          onEditingChange={onEditingChange}
          onCancel={() => setPreparingGrant(false)}
        />
      </PreparationSlot>
    </Section>
  );
}

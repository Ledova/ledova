import { useAutomaticReads } from '@hooks/useAutomaticReads';
import { useCallback, useEffect } from 'react';
import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { Row, Rows, Section, Loading, LoadError } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { SearchSelect } from '@components/SearchSelect';
import {
  COMPANY_SUBSCRIPTION_STATUS_LABELS,
  FIELD_LIMITS,
  REGISTER_PAID_ISSUE_COPY as COPY,
  REGISTER_PAID_ISSUE_DECISIONS,
  REGISTER_PAID_ISSUE_UNMET_COPY,
  formatDate,
  formatDateTime,
  formatMoney,
  formatShareCount,
  registerPaidIssueExecutionState,
  useCompanyPaidIssues,
  type RegisterPaidIssue,
  type RegisterPaidIssueSource,
  type SubscriptionStatus,
  refusalSentences,
  failureSentence,
  shareCount,
  shortReference,
} from '@ledova/shared';
import { DecisionTrail } from '@pages/company/ledger/shared/DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { usePaidIssuePreparation, usePaidIssueRecord, type Commands } from './useCompanyPaidIssueFlow';
import type { useShareClass } from './useShareClass';

const STAGES: Record<string, string> = COPY.STAGES;

const SUBSCRIPTIONS = ['subscription', 'subscriptions'] as const;
function SourceRows({ source }: { source: RegisterPaidIssueSource }) {
  return (
    <Rows>
      <Row label="Subscription">{shortReference(source.subscription)}</Row>
      <Row label="Offering">{shortReference(source.offering)}</Row>
      <Row label="Recipient">
        {source.recipientName || 'Name not recorded'} · {source.recipientAddress}
      </Row>
      <Row label="Requested shares">{formatShareCount(source.requestedShares)}</Row>
      <Row label="Recorded allotment">{formatShareCount(source.shares)}</Row>
      <Row label="Price per share">{formatMoney(source.pricePerShare, source.currency)}</Row>
      <Row label="Original due">{formatMoney(source.amountDue, source.currency)}</Row>
      <Row label="Recorded received">
        {source.amountReceived === null ? 'Not recorded' : formatMoney(source.amountReceived, source.currency)}
      </Row>
      <Row label="Recorded money held">{formatMoney(source.moneyHeld, source.currency)}</Row>
      <Row label={source.refundedAt ? 'Captured refunded amount' : 'Captured refund amount owed'}>
        {source.refundAmount === null ? 'Not recorded' : formatMoney(source.refundAmount, source.currency)}
      </Row>
      <Row label="Refund recorded in captured source">
        {source.refundedAt ? formatDateTime(source.refundedAt) : 'No refund recorded'}
      </Row>
      <Row label="Payment received date">{formatDate(source.paymentReceivedOn, 'Not recorded')}</Row>
      <Row label="Recorded payment reference">{source.paymentReferenceSeen || 'Not recorded'}</Row>
      <Row label="Recorded payment hash">{source.paymentTxHash || 'Not recorded'}</Row>
      <Row label="Payment recorded on">
        {source.paymentConfirmedAt ? formatDateTime(source.paymentConfirmedAt) : 'Not recorded'}
      </Row>
    </Rows>
  );
}

function SnapshotRows({
  record,
}: {
  record: Pick<RegisterPaidIssue, 'snapshot' | 'shares' | 'approvingDirector' | 'reason' | 'authorityReference'>;
}) {
  return (
    <>
      <Rows>
        <Row label="Company">
          {record.snapshot.company.name} · ACN {record.snapshot.company.acn}
        </Row>
        <Row label="Share class">
          {record.snapshot.token.name} · {record.snapshot.token.symbol}
        </Row>
        <Row label="Approving director">{record.approvingDirector}</Row>
        <Row label="Issue reason">{record.reason}</Row>
        <Row label="Authority reference">{record.authorityReference}</Row>
        <Row label="Contract">{record.snapshot.token.contractAddress}</Row>
        <Row label="Technical sender">{record.snapshot.transaction.sender}</Row>
      </Rows>
      <SourceRows source={record.snapshot.source} />
      <p className="text-sm text-text-muted">{COPY.PAYMENT_NOTE}</p>
    </>
  );
}

function PaidIssueRecord({
  record,
  commands,
  onHeldChange,
}: {
  record: RegisterPaidIssue;
  commands: Commands;
  onHeldChange: (uuid: string, held: boolean) => void;
}) {
  const { error, busy, download, execution } = usePaidIssueRecord({ record, commands });
  return (
    <div className="space-y-3 border-t border-border py-4">
      {commands.visible && (
        <>
          <h3 className="font-medium">{STAGES[record.stage] ?? record.stage} paid issue</h3>
          <SnapshotRows record={record} />
          <Rows>
            <Row label="Preparation reference">{shortReference(record.uuid)}</Row>
            <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>

            <Row label="Intent fingerprint">{record.intentDigest}</Row>
            {record.approvalDecision && <Row label="Consumed approval">{shortReference(record.approvalDecision)}</Row>}
            <Row label="Execution">{registerPaidIssueExecutionState(record)}</Row>
            <Row label="Original subscription status">
              {COMPANY_SUBSCRIPTION_STATUS_LABELS[record.subscriptionStatus as SubscriptionStatus]}
            </Row>
            <Row label="Actual allotment recorded">
              {record.allottedAt ? formatDateTime(record.allottedAt) : 'Not recorded'}
            </Row>
            <Row label="Original issuance request">
              {record.request ? shortReference(record.request) : 'No issuance request admitted'}
            </Row>
            {execution && (
              <>
                <Row label="Original execution">{shortReference(execution.execution)}</Row>
                <Row label="Original dispatch">{shortReference(execution.dispatchId)}</Row>
                {execution.operationId && <Row label="Original operation">{shortReference(execution.operationId)}</Row>}
                {execution.claimId && <Row label="Original claim">{shortReference(execution.claimId)}</Row>}
                {execution.txHash && <Row label="Transaction hash">{execution.txHash}</Row>}
                {execution.blockNumber !== null && <Row label="Original receipt block">{execution.blockNumber}</Row>}
                {execution.blockHash && <Row label="Original receipt block hash">{execution.blockHash}</Row>}
                <Row label="Original completion date">
                  {execution.completedAt ? formatDateTime(execution.completedAt) : 'Not recorded'}
                </Row>
                <Row label="Original issuance">
                  {execution.issuance ? shortReference(execution.issuance) : 'Not recorded'}
                </Row>
                <Row label="Register entry">
                  {execution.registerEntry ? shortReference(execution.registerEntry) : 'Not recorded'}
                </Row>
                <Row label="Entry effective date">{formatDate(execution.effectiveOn, 'Not recorded')}</Row>
              </>
            )}
          </Rows>
          <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
          <DecisionTrail proposal={record} labels={COPY.DECISIONS} />
          <p className="text-sm text-text-muted">{COPY.ADMITTED_NOTE}</p>
          {refusalSentences(record.executionUnmetRequirements, REGISTER_PAID_ISSUE_UNMET_COPY).map((sentence) => (
            <p key={sentence} className="text-sm text-text-muted">
              {sentence}
            </p>
          ))}
          <PageAction
            label="Download paid issue authority"
            context={`paid issue ${shortReference(record.uuid)}`}
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
        family={REGISTER_PAID_ISSUE_DECISIONS}
        copy={COPY}
        noun="paid issue"
        proposal={record}
        steps={commands.steps}
        guard={commands.guard}
        newEffectGuard={(kind) => commands.guardPaidIssue(kind, record)}
        onDecided={commands.accept}
        onRefused={commands.refresh}
        visible={commands.visible}
        onHeldChange={onHeldChange}
        context={`paid issue ${shortReference(record.uuid)}`}
      >
        {(preview) => (
          <>
            <SnapshotRows record={preview} />
            <p className="text-sm text-text-muted">{COPY.NOTE}</p>
          </>
        )}
      </RegisterDecisions>
    </div>
  );
}

function Preparation({ commands, onEditingChange }: { commands: Commands; onEditingChange: (held: boolean) => void }) {
  const {
    draft,
    captured,
    selections,
    director,
    setDirector,
    reference,
    setReference,
    reason,
    setReason,
    setFile,
    uploadRef,
    busy,
    error,
    setError,
    termsValid,
    problems,
    waiting,
    check,
    select,
    submit,
    candidates,
  } = usePaidIssuePreparation({ commands });
  const checks = useErrorSummary(problems);
  useEffect(() => {
    onEditingChange(draft.active);
    return () => onEditingChange(false);
  }, [draft, onEditingChange]);
  return (
    <fieldset
      disabled={waiting}
      className="grid gap-4 border-t border-border-subtle pt-4 sm:grid-cols-2 [&>p]:sm:col-span-2 [&>h3]:sm:col-span-2 [&>dl]:sm:col-span-2"
    >
      <h3 className="font-medium">Prepare a company paid issue</h3>
      <ErrorSummary {...checks.summary} className="sm:col-span-2" />
      <p className="text-sm text-text-muted">{COPY.PAYMENT_NOTE}</p>
      {commands.availableSubscriptions.isPending && <Loading>Loading recorded paid sources…</Loading>}
      {commands.availableSubscriptions.isError && (
        <LoadError
          retry={() => commands.availableSubscriptions.refetch()}
          busy={commands.availableSubscriptions.isFetching}
        >
          Available paid subscription sources could not be{' '}
          {commands.availableSubscriptions.data ? 'refreshed' : 'loaded'}. The captured draft remains, and fresh
          evidence is blocked.
        </LoadError>
      )}
      {commands.availableSubscriptions.isSuccess &&
        !commands.availableSubscriptions.isFetching &&
        candidates.length === 0 && (
          <p className="text-sm text-text-muted">
            No available paid subscription for this class. Existing admitted sources retain their original outcomes.
          </p>
        )}
      <SearchSelect
        {...checks.field('source')}
        label="Recorded paid subscription"
        choices={[
          ...(captured && !candidates.some((row) => row.subscription === captured.source.subscription)
            ? [captured.source]
            : []),
          ...candidates,
        ].map((row) => ({
          value: row.subscription,
          label: row.recipientName || 'Name not recorded',
          detail: `${shareCount(row.shares)} · ${row.recipientAddress}`,
        }))}
        value={captured?.source.subscription ?? ''}
        onChange={select}
        placeholder="Type an investor name or address"
        noun={SUBSCRIPTIONS}
      />
      {captured && <SourceRows source={captured.source} />}
      <PageAction
        label="Use current recorded source"
        disabled={!commands.canPrepare || !captured}
        onClick={() => {
          if (captured) select(captured.source.subscription);
        }}
      />
      <Field
        {...checks.field('director')}
        label="Approving director"
        hint="The company names a director other than the recipient. No director account is required."
      >
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
      <Field {...checks.field('reason')} label="Paid issue reason">
        <TextArea maxLength={FIELD_LIMITS.REASON} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <FileField
        key={selections}
        {...checks.field('file')}
        label="Paid issue authority document"
        hint={
          termsValid
            ? undefined
            : 'Available once the paid subscription, approving director, authority reference and reason are given.'
        }
        disabled={!commands.canPrepare || !termsValid}
        onClick={(event) => {
          try {
            check();
          } catch (failure) {
            event.preventDefault();
            setError(failureSentence(failure, 'The authority picker is unavailable.'));
          }
        }}
        onFile={(chosen) => {
          try {
            check();
            uploadRef.current = null;
            setFile(chosen);
            setError('');
          } catch (failure) {
            setError(failureSentence(failure, 'The authority document could not be selected.'));
          }
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-error-light">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <FormActions>
          <PageAction
            label="Prepare paid issue"
            busy={busy}
            busyLabel="Preparing…"
            disabled={waiting || !commands.canPrepare || !!commands.recovery}
            onClick={() => {
              if (checks.check()) void submit();
            }}
          />
        </FormActions>
      </div>
    </fieldset>
  );
}

export function CompanyPaidIssueFlow({
  uuid,
  data,
  active = true,
}: {
  uuid: string;
  data: ReturnType<typeof useShareClass>;
  active?: boolean;
}) {
  const onEditingChange = useCallback((held: boolean) => data.holdReads('paid/draft', held), [data.holdReads]);
  const onHeldChange = useCallback(
    (uuid: string, held: boolean) => data.holdReads('paid/decision/' + uuid, held),
    [data.holdReads],
  );
  const commands = useCompanyPaidIssues(uuid, {
    token: data.token.data,
    tokenKey: data.tokenKey,
    newKey: () => crypto.randomUUID(),
    coordinatedReads: true,
    paused: data.readingPaused,
    onPrepared: () => onEditingChange(false),
  });
  useEffect(() => {
    data.holdReads('paid/request', commands.working || !!commands.recovery);
    return () => data.holdReads('paid/request', false);
  }, [commands.working, commands.recovery, data.holdReads]);
  useAutomaticReads({
    scope: active && commands.owner ? data.scopeKey + '/paid' : null,
    paused: data.readingPaused || commands.readingPaused,
    refresh: commands.refresh,
  });
  if (!commands.owner) return null;
  return (
    <Section title={COPY.TITLE}>
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>

      {commands.appointments.isError ? (
        <LoadError retry={() => commands.refresh()} busy={commands.appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      ) : !commands.appointments.isSuccess || commands.appointments.isFetching ? (
        <Loading>Loading your appointments…</Loading>
      ) : (
        !commands.visible && (
          <p className="text-sm text-text-muted">
            Current personal register access for this company is required. Retained requests stay private until it is
            refreshed.
          </p>
        )
      )}
      {commands.visible && !commands.steps.prepare && (
        <p className="text-sm text-text-muted">
          You can read company paid issue history. Preparation requires current company administration or prepare
          capability.
        </p>
      )}
      {commands.visible && commands.instructions.isPending && <Loading>Loading company paid issue records…</Loading>}
      {commands.visible && commands.instructions.isError && (
        <LoadError
          retry={() => commands.refresh()}
          busy={commands.instructions.isFetching || commands.appointments.isFetching}
        >
          The paid issue records could not be {commands.instructions.data ? 'refreshed' : 'loaded'}. Retained original
          receipts remain available.
        </LoadError>
      )}
      {!!commands.company && (
        <div hidden={!commands.visible || !commands.steps.prepare}>
          <Preparation key={commands.scopeKey} commands={commands} onEditingChange={onEditingChange} />
        </div>
      )}
      {commands.visible && commands.recovery && (
        <div className="space-y-2">
          <p className="text-sm text-text-muted">
            The original paid issue preparation response is unresolved. Recover its identical body and operation
            reference.
          </p>
          <p>Operation reference {shortReference(commands.recovery.body.operationId)}</p>
          <PageAction
            label="Recover original paid issue preparation receipt"
            disabled={commands.busy}
            onClick={() => void commands.recover()}
          />
        </div>
      )}
      {commands.visible && commands.error && <p role="alert">{commands.error}</p>}
      {commands.records.map((record) => (
        <PaidIssueRecord key={record.uuid} record={record} commands={commands} onHeldChange={onHeldChange} />
      ))}
    </Section>
  );
}

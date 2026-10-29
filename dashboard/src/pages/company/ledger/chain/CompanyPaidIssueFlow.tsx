import { useEntryReads } from '@hooks/useEntryReads';
import { useCallback, useEffect, useState } from 'react';
import { generatePath } from 'react-router-dom';
import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { LinkRow, Row, Rows, Section, Loading, LoadError } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { SearchSelect } from '@components/SearchSelect';
import { pageTitle } from '@utils/destinations';
import {
  COMPANY_SUBSCRIPTION_STATUS_LABELS,
  DESTINATIONS,
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
} from '@ledova/shared';
import { DecisionTrail } from '@pages/company/ledger/shared/DecisionTrail';
import { RecordShell, RecordStage } from '@pages/company/ledger/shared/RecordShell';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { usePaidIssuePreparation, usePaidIssueRecord, type Commands } from './useCompanyPaidIssueFlow';
import { PreparationSlot } from './PreparationSlot';
import { TransactionRow } from '@pages/company/shared/TransactionRow';
import type { useShareClass } from '@pages/company/ledger/shared/useShareClass';

const STAGES: Record<string, string> = COPY.STAGES;

const SUBSCRIPTIONS = ['subscription', 'subscriptions'] as const;

function SourceRows({ source }: { source: RegisterPaidIssueSource }) {
  return (
    <>
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
    </>
  );
}

function IssueRows({
  record,
}: {
  record: Pick<RegisterPaidIssue, 'snapshot' | 'approvingDirector' | 'reason' | 'authorityReference'>;
}) {
  return (
    <>
      <Row label="Approving director">{record.approvingDirector}</Row>
      <Row label="Issue reason">{record.reason}</Row>
      <Row label="Authority reference">{record.authorityReference}</Row>
      <SourceRows source={record.snapshot.source} />
    </>
  );
}

function PaidIssueRecord({
  record,
  chain,
  isOwner,
  commands,
  onHeldChange,
}: {
  record: RegisterPaidIssue;
  chain: string | null | undefined;
  isOwner: boolean;
  commands: Commands;
  onHeldChange: (uuid: string, held: boolean) => void;
}) {
  const { error, busy, download, execution } = usePaidIssueRecord({ record, commands });
  const companyContext = useCompanyContext();
  const offering = generatePath(DESTINATIONS.companyOfferingDetail.path, { uuid: record.snapshot.source.offering });
  const recipient = record.snapshot.source.recipientName || 'Name not recorded';
  const context = `paid issue for ${recipient} prepared ${formatDateTime(record.createdAt)}`;
  return (
    <RecordShell hidden={!commands.visible}>
      {commands.visible && (
        <>
          <h3 className="font-medium">Paid issue to {recipient}</h3>
          <Rows>
            <RecordStage stage={record.stage}>{STAGES[record.stage] ?? record.stage}</RecordStage>
            <IssueRows record={record} />
            <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>
            <DecisionTrail proposal={record} labels={COPY.DECISIONS} />
            <Row label="Execution">{registerPaidIssueExecutionState(record)}</Row>
            <Row label="Current subscription status">
              {COMPANY_SUBSCRIPTION_STATUS_LABELS[record.subscriptionStatus as SubscriptionStatus]}
            </Row>
            <Row label="Actual allotment recorded">
              {record.allottedAt ? formatDateTime(record.allottedAt) : 'Not recorded'}
            </Row>
            {execution?.txHash && <TransactionRow chain={chain} hash={execution.txHash} />}
            {execution && (
              <>
                <Row label="Completed on">
                  {execution.completedAt ? formatDateTime(execution.completedAt) : 'Not recorded'}
                </Row>
                <Row label="Register entry date">{formatDate(execution.effectiveOn, 'Not recorded')}</Row>
              </>
            )}
          </Rows>
          {isOwner && (
            <LinkRow
              to={companyContext?.companyPath(offering) ?? offering}
              label={pageTitle('companyOfferingDetail')}
              context={`for ${recipient}`}
            />
          )}
          {record.status === 'applied' && <p className="text-sm text-text-muted">{COPY.ADMITTED_NOTE}</p>}
          {refusalSentences(record.executionUnmetRequirements, REGISTER_PAID_ISSUE_UNMET_COPY).map((sentence) => (
            <p key={sentence} className="text-sm text-text-muted">
              {sentence}
            </p>
          ))}
          <PageAction
            label="Download paid issue authority"
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
        context={context}
      >
        {(preview) => (
          <>
            <p className="text-sm text-text-muted">
              {preview.snapshot.token.name} · {preview.snapshot.token.symbol}
            </p>
            <Rows>
              <IssueRows record={preview} />
            </Rows>
            <p className="text-sm text-text-muted">{COPY.PAYMENT_NOTE}</p>
            <p className="text-sm text-text-muted">{COPY.NOTE}</p>
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
      className="grid min-w-0 gap-4 border-t border-border-subtle pt-4 sm:grid-cols-2 [&>*]:min-w-0 [&>p]:sm:col-span-2 [&>h3]:sm:col-span-2 [&>dl]:sm:col-span-2"
    >
      <h3 className="font-medium">Prepare a paid issue</h3>
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
      {captured && (
        <Rows>
          <SourceRows source={captured.source} />
        </Rows>
      )}
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
      <Field {...checks.field('reason')} label="Paid issue reason" className="sm:col-span-2">
        <TextArea maxLength={FIELD_LIMITS.REASON} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <FileField
        showUploadHint={false}
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
          <PageAction label="Cancel" disabled={waiting} onClick={onCancel} />
          <PageAction
            primary
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

export function CompanyPaidIssueFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useShareClass> }) {
  const [preparing, setPreparing] = useState(false);
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
    onPrepared: () => {
      onEditingChange(false);
      setPreparing(false);
    },
  });
  useEffect(() => {
    data.holdReads('paid/request', commands.working || !!commands.recovery);
    return () => data.holdReads('paid/request', false);
  }, [commands.working, commands.recovery, data.holdReads]);
  useEntryReads({
    scope: commands.owner ? data.scopeKey + '/paid' : null,
    paused: data.readingPaused || commands.readingPaused,
    refresh: commands.refresh,
  });
  if (!commands.owner) return null;
  const token = data.token.data;
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
      {commands.visible && commands.records.length > 0 && (
        <>
          <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
          <p className="text-sm text-text-muted">{COPY.PAYMENT_NOTE}</p>
        </>
      )}
      {commands.records.length > 0 && (
        <ul hidden={!commands.visible} className="divide-y divide-border-subtle">
          {commands.records.map((record) => (
            <PaidIssueRecord
              key={record.uuid}
              record={record}
              chain={token?.chain}
              isOwner={token?.isOwner === true}
              commands={commands}
              onHeldChange={onHeldChange}
            />
          ))}
        </ul>
      )}
      {commands.visible && commands.recovery && (
        <div className="space-y-2">
          <p className="text-sm text-text-muted">
            The original paid issue preparation response is unresolved. Recover it with its identical original request.
          </p>
          <PageAction
            label="Recover original paid issue preparation receipt"
            disabled={commands.busy}
            onClick={() => void commands.recover()}
          />
        </div>
      )}
      {commands.visible && commands.error && <p role="alert">{commands.error}</p>}
      {!!commands.company && (
        <PreparationSlot
          label="Prepare paid issue"
          open={preparing}
          available={commands.visible && !!commands.steps.prepare}
          disabled={!commands.canPrepare}
          hidden={!commands.visible || !commands.steps.prepare}
          onOpen={() => setPreparing(true)}
        >
          <Preparation
            key={commands.scopeKey}
            commands={commands}
            onEditingChange={onEditingChange}
            onCancel={() => setPreparing(false)}
          />
        </PreparationSlot>
      )}
    </Section>
  );
}

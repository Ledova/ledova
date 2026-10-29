import { useEntryReads } from '@hooks/useEntryReads';
import { useCallback, useEffect, useState } from 'react';
import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { Choices } from '@components/Choices';
import { Row, Rows, Section, Loading, LoadError } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import {
  FIELD_LIMITS,
  REGISTER_PAUSE_CHANGE_COPY as COPY,
  REGISTER_PAUSE_CHANGE_DECISIONS,
  REGISTER_PAUSE_CHANGE_UNMET_COPY,
  formatDateTime,
  registerPauseChangeExecutionState,
  useCompanyPauseChanges,
  type RegisterPauseChange,
  refusalSentences,
  failureSentence,
} from '@ledova/shared';
import { DecisionTrail } from '@pages/company/ledger/shared/DecisionTrail';
import { RecordShell, RecordStage } from '@pages/company/ledger/shared/RecordShell';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { usePausePreparation, usePauseRecord, type Commands } from './useCompanyPauseFlow';
import { PreparationSlot } from './PreparationSlot';
import { TransactionRow } from '@pages/company/shared/TransactionRow';
import type { useShareClass } from '@pages/company/ledger/shared/useShareClass';

const STAGES: Record<string, string> = COPY.STAGES;

const STATES = [
  ['paused', 'Paused'],
  ['unpaused', 'Unpaused'],
] as const;

function PauseRows({ record }: { record: Pick<RegisterPauseChange, 'paused' | 'reason' | 'authorityReference'> }) {
  return (
    <>
      <Row label="Requested state">
        {record.paused === true ? 'Paused' : record.paused === false ? 'Unpaused' : 'Not recorded'}
      </Row>
      <Row label="Reason">{record.reason}</Row>
      <Row label="Authority reference">{record.authorityReference}</Row>
    </>
  );
}

function PauseRecord({
  record,
  chain,
  commands,
  onHeldChange,
}: {
  record: RegisterPauseChange;
  chain: string | null | undefined;
  commands: Commands;
  onHeldChange: (uuid: string, held: boolean) => void;
}) {
  const { error, busy, download, execution } = usePauseRecord({ record, commands });
  const context = `pause change prepared ${formatDateTime(record.createdAt)}`;
  return (
    <RecordShell hidden={!commands.visible}>
      {commands.visible && (
        <>
          <h3 className="font-medium">
            {record.paused === true
              ? 'Pause the class'
              : record.paused === false
                ? 'Unpause the class'
                : 'Pause change'}
          </h3>
          <Rows>
            <RecordStage stage={record.stage}>{STAGES[record.stage] ?? record.stage}</RecordStage>
            <PauseRows record={record} />
            <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>
            <DecisionTrail proposal={record} labels={COPY.DECISIONS} />
            <Row label="Execution">{registerPauseChangeExecutionState(record)}</Row>
            {execution?.txHash && <TransactionRow chain={chain} hash={execution.txHash} />}
            {execution?.observation && (
              <Row label="Observed on">{formatDateTime(execution.observation.observedAt)}</Row>
            )}
            {execution && (
              <Row label="Completed on">
                {execution.completedAt ? formatDateTime(execution.completedAt) : 'Not recorded'}
              </Row>
            )}
          </Rows>
          {record.status === 'applied' && <p className="text-sm text-text-muted">{COPY.ADMITTED_NOTE}</p>}
          {refusalSentences(record.executionUnmetRequirements, REGISTER_PAUSE_CHANGE_UNMET_COPY).map((sentence) => (
            <p key={sentence} className="text-sm text-text-muted">
              {sentence}
            </p>
          ))}
          <PageAction
            label="Download pause authority"
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
        family={REGISTER_PAUSE_CHANGE_DECISIONS}
        copy={COPY}
        noun="pause change"
        proposal={record}
        steps={commands.steps}
        guard={commands.guard}
        newEffectGuard={(kind) => commands.guardPause(kind, record)}
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
              <PauseRows record={preview} />
            </Rows>
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
    setCaptured,
    paused,
    setPaused,
    reason,
    setReason,
    reference,
    setReference,
    setFile,
    uploadRef,
    busy,
    error,
    setError,
    termsValid,
    problems,
    waiting,
    check,
    submit,
  } = usePausePreparation({ commands });
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
      <h3 className="font-medium">Prepare a pause change</h3>
      <ErrorSummary {...checks.summary} className="sm:col-span-2" />
      <PageAction
        label="Use current class details"
        disabled={!commands.canPrepare}
        onClick={() => {
          commands.guardStep('prepare');
          setCaptured(commands.source ? { ...commands.source } : undefined);
        }}
      />
      <div className="sm:col-span-2">
        <Choices
          {...checks.field('paused')}
          legend="Requested state"
          options={STATES}
          value={paused === null ? '' : paused ? 'paused' : 'unpaused'}
          onChange={(state) => setPaused(state === 'paused')}
        />
      </div>
      <Field {...checks.field('reason')} label="Pause reason" className="sm:col-span-2">
        <TextArea maxLength={FIELD_LIMITS.REASON} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <Field {...checks.field('reference')} label="Authority reference">
        <TextInput
          maxLength={FIELD_LIMITS.REFERENCE}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </Field>
      <FileField
        showUploadHint={false}
        {...checks.field('file')}
        label="Pause authority document"
        hint={termsValid ? undefined : 'Available once the requested state, reason and authority reference are given.'}
        disabled={!commands.canPrepare || !termsValid}
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
            label="Prepare pause change"
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

export function CompanyPauseFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useShareClass> }) {
  const [preparing, setPreparing] = useState(false);
  const onEditingChange = useCallback((held: boolean) => data.holdReads('pause/draft', held), [data.holdReads]);
  const onHeldChange = useCallback(
    (uuid: string, held: boolean) => data.holdReads('pause/decision/' + uuid, held),
    [data.holdReads],
  );
  const commands = useCompanyPauseChanges(uuid, {
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
    data.holdReads('pause/request', commands.working || !!commands.recovery);
    return () => data.holdReads('pause/request', false);
  }, [commands.working, commands.recovery, data.holdReads]);
  useEntryReads({
    scope: commands.owner ? data.scopeKey + '/pause' : null,
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
          You can read company pause history. Preparation requires current company administration or prepare capability.
        </p>
      )}
      {commands.visible && commands.instructions.isPending && <Loading>Loading company pause records…</Loading>}
      {commands.visible && commands.instructions.isError && (
        <LoadError
          retry={() => commands.refresh()}
          busy={commands.instructions.isFetching || commands.appointments.isFetching}
        >
          The pause records could not be {commands.instructions.data ? 'refreshed' : 'loaded'}. Retained original
          receipts remain available.
        </LoadError>
      )}
      {commands.visible && commands.records.length > 0 && (
        <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
      )}
      {commands.records.length > 0 && (
        <ul hidden={!commands.visible} className="divide-y divide-border-subtle">
          {commands.records.map((record) => (
            <PauseRecord
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
        <div className="space-y-2">
          <p className="text-sm text-text-muted">
            The original pause preparation response is unresolved. Recover it with its identical original request.
          </p>
          <PageAction
            label="Recover original pause preparation receipt"
            disabled={commands.busy}
            onClick={() => void commands.recover()}
          />
        </div>
      )}
      {commands.visible && commands.error && <p role="alert">{commands.error}</p>}
      {!!commands.company && (
        <PreparationSlot
          label="Prepare pause change"
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

import { useEntryReads } from '@hooks/useEntryReads';
import { useCallback, useEffect, useState } from 'react';
import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { Row, Rows, Section, Loading, LoadError } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import {
  FIELD_LIMITS,
  REGISTER_CAPITAL_INCREASE_COPY as COPY,
  REGISTER_CAPITAL_INCREASE_DECISIONS,
  REGISTER_CAPITAL_INCREASE_UNMET_COPY,
  formatDateTime,
  formatShareCount,
  registerCapitalIncreaseExecutionState,
  useCompanyCapitalIncreases,
  type RegisterCapitalIncrease,
  type RegisterCapitalIncreaseSnapshot,
  refusalSentences,
} from '@ledova/shared';
import { DecisionTrail } from '@pages/company/ledger/shared/DecisionTrail';
import { RecordShell, RecordStage } from '@pages/company/ledger/shared/RecordShell';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { useCapitalPreparation, useCapitalRecord, type Commands } from './useCompanyCapitalFlow';
import { PreparationSlot } from './PreparationSlot';
import { TransactionRow } from '@pages/company/ledger/shared/TransactionRow';
import type { useShareClass } from '@pages/company/ledger/shared/useShareClass';

const STAGES: Record<string, string> = COPY.STAGES;

function CapitalRows({ snapshot }: { snapshot: RegisterCapitalIncreaseSnapshot }) {
  return (
    <>
      <Row label="Captured authorised cap">{formatShareCount(snapshot.capital.priorAuthorizedTotal)}</Row>
      <Row label="Increase">{formatShareCount(snapshot.capital.additionalShares)}</Row>
      <Row label="New authorised cap">{formatShareCount(snapshot.capital.newAuthorizedTotal)}</Row>
      <Row label="Purpose">{snapshot.capital.purpose}</Row>
      <Row label="Board resolution reference">{snapshot.capital.boardResolutionReference}</Row>
      <Row label="Shareholder approval reference">
        {snapshot.capital.shareholderApprovalReference || 'Not provided'}
      </Row>
    </>
  );
}

function CapitalRecord({
  record,
  chain,
  commands,
  onHeldChange,
}: {
  record: RegisterCapitalIncrease;
  chain: string | null | undefined;
  commands: Commands;
  onHeldChange: (uuid: string, held: boolean) => void;
}) {
  const { error, busy, download, execution } = useCapitalRecord({ record, commands });
  const context = `capital increase prepared ${formatDateTime(record.createdAt)}`;
  return (
    <RecordShell hidden={!commands.visible}>
      {commands.visible && (
        <>
          <h3 className="font-medium">
            Increase of {formatShareCount(record.snapshot.capital.additionalShares)} authorised shares
          </h3>
          <Rows>
            <RecordStage stage={record.stage}>{STAGES[record.stage] ?? record.stage}</RecordStage>
            <CapitalRows snapshot={record.snapshot} />
            <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>
            <DecisionTrail proposal={record} labels={COPY.DECISIONS} />
            <Row label="Execution">{registerCapitalIncreaseExecutionState(record)}</Row>
            {execution?.txHash && <TransactionRow chain={chain} hash={execution.txHash} />}
            {execution && (
              <Row label="Recorded on">
                {execution.projectedAt ? formatDateTime(execution.projectedAt) : 'Not recorded'}
              </Row>
            )}
          </Rows>
          {record.status === 'applied' && <p className="text-sm text-text-muted">{COPY.ADMITTED_NOTE}</p>}
          {refusalSentences(record.executionUnmetRequirements, REGISTER_CAPITAL_INCREASE_UNMET_COPY).map((sentence) => (
            <p key={sentence} className="text-sm text-text-muted">
              {sentence}
            </p>
          ))}
          <PageAction
            label="Download capital authority"
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
        family={REGISTER_CAPITAL_INCREASE_DECISIONS}
        copy={COPY}
        noun="capital increase"
        proposal={record}
        steps={commands.steps}
        guard={commands.guard}
        newEffectGuard={(kind) => commands.guardCapital(kind, record)}
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
              <CapitalRows snapshot={preview.snapshot} />
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
    before,
    setBefore,
    additional,
    setAdditional,
    purpose,
    setPurpose,
    board,
    setBoard,
    shareholder,
    setShareholder,
    setFile,
    uploadRef,
    busy,
    error,
    setError,
    total,
    problems,
    waiting,
    submit,
  } = useCapitalPreparation({ commands });
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
      <h3 className="font-medium">Prepare a capital increase</h3>
      <ErrorSummary {...checks.summary} className="sm:col-span-2" />
      <Rows>
        <Row label="Captured authorised cap">
          <span className="min-w-0 break-all">{formatShareCount(before)}</span>
        </Row>
      </Rows>
      {commands.source?.totalSupply !== before && (
        <PageAction
          label="Use current authorised cap"
          disabled={!commands.canPrepare}
          onClick={() => {
            commands.guardStep('prepare');
            setBefore(commands.source!.totalSupply);
          }}
        />
      )}
      <Field {...checks.field('additional')} label="Additional authorised shares">
        <TextInput
          maxLength={FIELD_LIMITS.WHOLE_SHARES}
          inputMode="numeric"
          value={additional}
          onChange={(event) => setAdditional(event.target.value)}
        />
      </Field>
      {total !== null && <p className="min-w-0 break-all text-sm">New authorised cap: {formatShareCount(total)}</p>}
      <Field {...checks.field('purpose')} label="Purpose" className="sm:col-span-2">
        <TextArea value={purpose} onChange={(event) => setPurpose(event.target.value)} />
      </Field>
      <Field {...checks.field('board')} label="Board resolution reference">
        <TextInput
          maxLength={FIELD_LIMITS.REFERENCE}
          value={board}
          onChange={(event) => setBoard(event.target.value)}
        />
      </Field>
      <Field label="Shareholder approval reference (optional)">
        <TextInput
          maxLength={FIELD_LIMITS.REFERENCE}
          value={shareholder}
          onChange={(event) => setShareholder(event.target.value)}
        />
      </Field>
      <FileField
        showUploadHint={false}
        {...checks.field('file')}
        label="Capital authority document"
        onFile={(chosen) => {
          uploadRef.current = null;
          setFile(chosen);
          setError('');
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
            label="Prepare capital increase"
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

export function CompanyCapitalFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useShareClass> }) {
  const [preparing, setPreparing] = useState(false);
  const onEditingChange = useCallback((held: boolean) => data.holdReads('capital/draft', held), [data.holdReads]);
  const onHeldChange = useCallback(
    (uuid: string, held: boolean) => data.holdReads('capital/decision/' + uuid, held),
    [data.holdReads],
  );
  const commands = useCompanyCapitalIncreases(uuid, {
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
    data.holdReads('capital/request', commands.working || !!commands.recovery);
    return () => data.holdReads('capital/request', false);
  }, [commands.working, commands.recovery, data.holdReads]);
  useEntryReads({
    scope: commands.owner ? data.scopeKey + '/capital' : null,
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
          You can read company capital history. Preparation requires current company administration or prepare
          capability.
        </p>
      )}
      {commands.visible && commands.instructions.isPending && <Loading>Loading company capital records…</Loading>}
      {commands.visible && commands.instructions.isError && (
        <LoadError
          retry={() => commands.refresh()}
          busy={commands.instructions.isFetching || commands.appointments.isFetching}
        >
          The capital records could not be {commands.instructions.data ? 'refreshed' : 'loaded'}. Retained original
          receipts remain available.
        </LoadError>
      )}
      {commands.visible && commands.records.length > 0 && (
        <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
      )}
      {commands.records.length > 0 && (
        <ul hidden={!commands.visible} className="divide-y divide-border-subtle">
          {commands.records.map((record) => (
            <CapitalRecord
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
            The original capital preparation response is unresolved. Recover it with its identical original request.
          </p>
          <PageAction
            label="Recover original capital preparation receipt"
            disabled={commands.busy}
            onClick={() => void commands.recover()}
          />
        </div>
      )}
      {commands.visible && commands.error && <p role="alert">{commands.error}</p>}
      {!!commands.company && (
        <PreparationSlot
          label="Prepare capital increase"
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

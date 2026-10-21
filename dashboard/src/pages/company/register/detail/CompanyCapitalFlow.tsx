import { Field, TextArea, TextInput, FileField } from '@components/Field';
import { Row, Rows, Section, Loading, LoadError } from '@components/Ledger';
import { PageAction } from '@components/Page';
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
  shortReference,
} from '@ledova/shared';
import { DecisionTrail } from '@pages/company/register/shared/DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { useCapitalPreparation, useCapitalRecord, type Commands } from './useCompanyCapitalFlow';
import type { useShareClass } from './useShareClass';
const STAGES: Record<string, string> = COPY.STAGES;

function SnapshotRows({ snapshot }: { snapshot: RegisterCapitalIncreaseSnapshot }) {
  return (
    <Rows>
      <Row label="Company">
        {snapshot.company.name} · ACN {snapshot.company.acn}
      </Row>
      <Row label="Share class">
        {snapshot.token.name} · {snapshot.token.symbol}
      </Row>
      <Row label="Captured authorised cap">{formatShareCount(snapshot.capital.priorAuthorizedTotal)}</Row>
      <Row label="Increase">{formatShareCount(snapshot.capital.additionalShares)}</Row>
      <Row label="New authorised cap">{formatShareCount(snapshot.capital.newAuthorizedTotal)}</Row>
      <Row label="Purpose">{snapshot.capital.purpose}</Row>
      <Row label="Board resolution reference">{snapshot.capital.boardResolutionReference}</Row>
      <Row label="Shareholder approval reference">
        {snapshot.capital.shareholderApprovalReference || 'Not provided'}
      </Row>
      <Row label="Shares minted">0</Row>
      <Row label="Contract">{snapshot.token.contractAddress}</Row>
      <Row label="Technical sender">{snapshot.transaction.sender}</Row>
    </Rows>
  );
}

function CapitalRecord({ record, commands }: { record: RegisterCapitalIncrease; commands: Commands }) {
  const { error, busy, download, execution } = useCapitalRecord({ record, commands });
  return (
    <div className="space-y-3 border-t border-border py-4">
      {commands.visible && (
        <>
          <h3 className="font-medium">{STAGES[record.stage] ?? record.stage} capital increase</h3>
          <SnapshotRows snapshot={record.snapshot} />
          <Rows>
            <Row label="Preparation reference">{shortReference(record.uuid)}</Row>
            <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>
            <Row label="Original request">{shortReference(record.request)}</Row>
            <Row label="Intent fingerprint">{record.intentDigest}</Row>
            {record.approvalDecision && <Row label="Consumed approval">{shortReference(record.approvalDecision)}</Row>}
            <Row label="Execution">{registerCapitalIncreaseExecutionState(record)}</Row>
            {execution && (
              <>
                <Row label="Original execution">{shortReference(execution.execution)}</Row>
                <Row label="Dispatch">{shortReference(execution.dispatchId)}</Row>
                {execution.operationId && <Row label="Original operation">{shortReference(execution.operationId)}</Row>}
                {execution.claimId && <Row label="Original claim">{shortReference(execution.claimId)}</Row>}
                {execution.txHash && <Row label="Transaction hash">{execution.txHash}</Row>}
                {execution.blockNumber !== null && <Row label="Original receipt block">{execution.blockNumber}</Row>}
                {execution.blockHash && <Row label="Original receipt block hash">{execution.blockHash}</Row>}
                {execution.gasUsed !== null && <Row label="Original receipt gas used">{execution.gasUsed}</Row>}
                <Row label="Original projection date">
                  {execution.projectedAt ? formatDateTime(execution.projectedAt) : 'Not recorded'}
                </Row>
              </>
            )}
          </Rows>
          <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
          <DecisionTrail proposal={record} labels={COPY.DECISIONS} />
          <p className="text-sm text-text-muted">{COPY.ADMITTED_NOTE}</p>
          {refusalSentences(record.executionUnmetRequirements, REGISTER_CAPITAL_INCREASE_UNMET_COPY).map((sentence) => (
            <p key={sentence} className="text-sm text-text-muted">
              {sentence}
            </p>
          ))}
          <PageAction
            label="Download capital authority"
            context={`capital ${shortReference(record.uuid)}`}
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
        context={`capital ${shortReference(record.uuid)}`}
      >
        {(preview) => (
          <>
            <SnapshotRows snapshot={preview.snapshot} />
            <p className="text-sm text-text-muted">{COPY.NOTE}</p>
          </>
        )}
      </RegisterDecisions>
    </div>
  );
}

function Preparation({ commands }: { commands: Commands }) {
  const {
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
  return (
    <fieldset
      disabled={waiting}
      className="grid gap-4 rounded-xl border border-border-subtle bg-surface-tertiary p-4 sm:grid-cols-2 [&>p]:sm:col-span-2 [&>h3]:sm:col-span-2 [&>dl]:sm:col-span-2"
    >
      <h3 className="font-medium">Prepare a company capital increase</h3>
      <ErrorSummary {...checks.summary} className="sm:col-span-2" />
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
      <p className="text-sm">Captured authorised cap: {formatShareCount(before)}</p>
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
      {total !== null && <p className="text-sm">New authorised cap: {formatShareCount(total)}</p>}
      <Field {...checks.field('purpose')} label="Purpose">
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
      <PageAction
        label="Prepare capital increase"
        busy={busy}
        busyLabel="Preparing…"
        disabled={waiting || !commands.canPrepare || !!commands.recovery}
        onClick={() => {
          if (checks.check()) void submit();
        }}
      />
    </fieldset>
  );
}

export function CompanyCapitalFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useShareClass> }) {
  const commands = useCompanyCapitalIncreases(uuid, {
    token: data.token.data,
    tokenKey: data.tokenKey,
    newKey: () => crypto.randomUUID(),
  });
  if (!commands.owner) return null;
  return (
    <Section title={COPY.TITLE}>
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
      {!(commands.appointments.isError || (commands.visible && commands.instructions.isError)) && (
        <PageAction
          label="Refresh company capital records"
          busy={commands.instructions.isFetching || commands.appointments.isFetching}
          busyLabel="Refreshing…"
          disabled={commands.busy}
          onClick={() => void commands.refresh()}
        />
      )}
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
      {!!commands.company && (
        <div hidden={!commands.visible || !commands.steps.prepare}>
          <Preparation key={commands.scopeKey} commands={commands} />
        </div>
      )}
      {commands.visible && commands.recovery && (
        <div className="space-y-2">
          <p className="text-sm text-text-muted">
            The original capital preparation response is unresolved. Recover its identical body and operation UUID.
          </p>
          <p>Operation reference {shortReference(commands.recovery.body.operationId)}</p>
          <PageAction
            label="Recover original capital preparation receipt"
            disabled={commands.busy}
            onClick={() => void commands.recover()}
          />
        </div>
      )}
      {commands.visible && commands.error && <p role="alert">{commands.error}</p>}
      {commands.records.map((record) => (
        <CapitalRecord key={record.uuid} record={record} commands={commands} />
      ))}
    </Section>
  );
}

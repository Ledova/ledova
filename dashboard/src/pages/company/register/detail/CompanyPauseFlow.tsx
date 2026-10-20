import { Choices } from '@components/Choices';
import { Row, Rows, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import {
  REGISTER_PAUSE_CHANGE_COPY as COPY,
  REGISTER_PAUSE_CHANGE_DECISIONS,
  REGISTER_PAUSE_CHANGE_UNMET_COPY,
  formatDateTime,
  getErrorMessage,
  registerPauseChangeExecutionState,
  useCompanyPauseChanges,
  type RegisterPauseChange,
} from '@ledova/shared';
import { DecisionTrail } from '@pages/company/register/shared/DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { usePausePreparation, usePauseRecord, type Commands } from './useCompanyPauseFlow';
import type { useShareClass } from './useShareClass';
const STAGES: Record<string, string> = COPY.STAGES;

const STATES = [
  ['paused', 'Paused'],
  ['unpaused', 'Unpaused'],
] as const;
function SnapshotRows({
  record,
}: {
  record: Pick<RegisterPauseChange, 'snapshot' | 'paused' | 'reason' | 'authorityReference'>;
}) {
  return (
    <Rows>
      <Row label="Company">
        {record.snapshot.company.name} · ACN {record.snapshot.company.acn}
      </Row>
      <Row label="Share class">
        {record.snapshot.token.name} · {record.snapshot.token.symbol}
      </Row>
      <Row label="Requested state">
        {record.paused === true ? 'Paused' : record.paused === false ? 'Unpaused' : 'Not recorded'}
      </Row>
      <Row label="Reason">{record.reason}</Row>
      <Row label="Authority reference">{record.authorityReference}</Row>
      <Row label="Contract">{record.snapshot.token.contractAddress}</Row>
      <Row label="Technical sender">{record.snapshot.transaction.sender}</Row>
    </Rows>
  );
}

function PauseRecord({ record, commands }: { record: RegisterPauseChange; commands: Commands }) {
  const { error, busy, download, execution } = usePauseRecord({ record, commands });
  return (
    <div className="space-y-3 border-t border-border py-4">
      {commands.visible && (
        <>
          <h3 className="font-medium">{STAGES[record.stage] ?? record.stage} pause change</h3>
          <SnapshotRows record={record} />
          <Rows>
            <Row label="Preparation ID">{record.uuid}</Row>
            <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>

            <Row label="Intent fingerprint">{record.intentDigest}</Row>
            {record.approvalDecision && <Row label="Consumed approval">{record.approvalDecision}</Row>}
            <Row label="Execution">{registerPauseChangeExecutionState(record)}</Row>
            {execution && (
              <>
                <Row label="Original submission">{execution.submissionId}</Row>
                {execution.operationId && <Row label="Original operation">{execution.operationId}</Row>}
                {execution.claimId && <Row label="Original claim">{execution.claimId}</Row>}
                {execution.txHash && <Row label="Transaction hash">{execution.txHash}</Row>}
                {execution.blockNumber !== null && <Row label="Original receipt block">{execution.blockNumber}</Row>}
                {execution.blockHash && <Row label="Original receipt block hash">{execution.blockHash}</Row>}
                {execution.gasUsed !== null && <Row label="Original receipt gas used">{execution.gasUsed}</Row>}
                {execution.observation && (
                  <>
                    <Row label="Original observation block">{execution.observation.blockNumber}</Row>
                    <Row label="Original observation block hash">{execution.observation.blockHash}</Row>
                    <Row label="Original observation time">{formatDateTime(execution.observation.observedAt)}</Row>
                  </>
                )}
                <Row label="Original completion date">
                  {execution.completedAt ? formatDateTime(execution.completedAt) : 'Not recorded'}
                </Row>
              </>
            )}
          </Rows>
          <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
          <DecisionTrail proposal={record} labels={COPY.DECISIONS} />
          <p className="text-sm text-text-muted">{COPY.ADMITTED_NOTE}</p>
          {record.executionUnmetRequirements.map((code) => (
            <p key={code} className="text-sm text-text-muted">
              {REGISTER_PAUSE_CHANGE_UNMET_COPY[code] ?? code}
            </p>
          ))}
          <PageAction
            label="Download pause authority"
            context={`pause ${record.uuid}`}
            busy={busy}
            busyLabel="Downloading…"
            onClick={() => void download()}
          />
          {error && <p role="alert">{error}</p>}
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
        context={`pause ${record.uuid}`}
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

function Preparation({ commands }: { commands: Commands }) {
  const {
    setCaptured,
    paused,
    setPaused,
    reason,
    setReason,
    reference,
    setReference,
    file,
    setFile,
    uploadRef,
    busy,
    error,
    setError,
    termsValid,
    waiting,
    check,
    submit,
  } = usePausePreparation({ commands });
  return (
    <fieldset
      disabled={waiting}
      className="grid gap-4 rounded-xl border border-border-subtle bg-surface-tertiary p-4 sm:grid-cols-2 [&>p]:sm:col-span-2 [&>h3]:sm:col-span-2 [&>dl]:sm:col-span-2"
    >
      <h3 className="font-medium">Prepare a company pause change</h3>
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
      <PageAction
        label="Use current class details"
        disabled={!commands.canPrepare}
        onClick={() => {
          commands.guardStep('prepare');
          setCaptured(commands.source ? { ...commands.source } : undefined);
        }}
      />
      <Choices
        legend="Requested state"
        options={STATES}
        value={paused === null ? '' : paused ? 'paused' : 'unpaused'}
        onChange={(state) => setPaused(state === 'paused')}
      />
      <label className="block text-sm">
        Pause reason
        <textarea
          className={FIELD_CLASS}
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        Authority reference
        <input
          className={FIELD_CLASS}
          maxLength={255}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        Pause authority document
        <input
          className={FIELD_CLASS}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          disabled={!commands.canPrepare || !termsValid}
          onChange={(event) => {
            try {
              check();
              const chosen = event.target.files?.[0] ?? null;
              if (
                chosen &&
                (!['application/pdf', 'image/png', 'image/jpeg'].includes(chosen.type) ||
                  chosen.size <= 0 ||
                  chosen.size > 10 * 1024 * 1024)
              )
                throw new Error('Choose a PDF, PNG or JPEG of up to 10 MB.');
              uploadRef.current = null;
              setFile(chosen);
              setError('');
            } catch (failure) {
              setError(
                getErrorMessage(failure, 'The authority document could not be selected.') ??
                  'The document could not be selected.',
              );
            }
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <PageAction
        label="Prepare pause change"
        busy={busy}
        busyLabel="Preparing…"
        disabled={waiting || !commands.canPrepare || !!commands.recovery || !termsValid || !file}
        onClick={() => void submit()}
      />
    </fieldset>
  );
}

export function CompanyPauseFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useShareClass> }) {
  const commands = useCompanyPauseChanges(uuid, {
    token: data.token.data,
    tokenKey: data.tokenKey,
    newKey: () => crypto.randomUUID(),
  });
  if (!commands.owner) return null;
  return (
    <Section title={COPY.TITLE}>
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
      <PageAction
        label="Refresh company pause records"
        disabled={commands.busy}
        onClick={() => void commands.refresh()}
      />
      {!commands.visible && (
        <p className="text-sm text-text-muted">
          Current personal register access for this company is required. Retained requests stay private until it is
          refreshed.
        </p>
      )}
      {commands.visible && !commands.steps.prepare && (
        <p className="text-sm text-text-muted">
          You can read company pause history. Preparation requires current company administration or prepare capability.
        </p>
      )}
      {commands.visible && commands.instructions.isPending && <p role="status">Loading company pause records…</p>}
      {commands.visible && commands.instructions.isError && (
        <p role="alert">The pause records could not be refreshed. Retained original receipts remain available.</p>
      )}
      {!!commands.company && (
        <div hidden={!commands.visible || !commands.steps.prepare}>
          <Preparation key={commands.scopeKey} commands={commands} />
        </div>
      )}
      {commands.visible && commands.recovery && (
        <div className="space-y-2">
          <p className="text-sm text-text-muted">
            The original pause preparation response is unresolved. Recover its identical body and operation UUID.
          </p>
          <p>{commands.recovery.body.operationId}</p>
          <PageAction
            label="Recover original pause preparation receipt"
            disabled={commands.busy}
            onClick={() => void commands.recover()}
          />
        </div>
      )}
      {commands.visible && commands.error && <p role="alert">{commands.error}</p>}
      {commands.records.map((record) => (
        <PauseRecord key={record.uuid} record={record} commands={commands} />
      ))}
    </Section>
  );
}

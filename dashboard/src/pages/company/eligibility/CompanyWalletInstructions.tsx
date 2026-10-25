import { Field, TextInput } from '@components/Field';
import { Choices } from '@components/Choices';
import { CompanyPicker } from '@components/CompanyPicker';
import { useCallback, useState } from 'react';
import { useAutomaticReads } from '@hooks/useAutomaticReads';
import { useRunningAction } from '@hooks/useRunningAction';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';
import {
  useCompanyWalletInstructions,
  COMPANY_WALLET_COPY as COPY,
  COMPANY_WALLET_DECISIONS,
  COMPANY_WALLET_UNMET_COPY,
  companyWalletExecutionState,
  formatDateTime,
  type CompanyWalletInstruction,
  type CompanyWalletDecisionPreview,
  refusalSentences,
  COMPANY_WALLET_ACTION_LABELS,
  shortReference,
  CHAIN_FAILURE_LABELS,
} from '@ledova/shared';
import { Row, Rows, Section, LoadError } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { SearchSelect } from '@components/SearchSelect';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';

type Read = ReturnType<typeof useCompanyWalletInstructions>;

const WALLETS = ['wallet', 'wallets'] as const;

const ACTIONS = [
  ['add', COMPANY_WALLET_ACTION_LABELS.add],
  ['remove', COMPANY_WALLET_ACTION_LABELS.remove],
] as const;
function Snapshot({ snapshot }: { snapshot: CompanyWalletInstruction['snapshot'] }) {
  return (
    <Rows>
      <Row label="Company">{snapshot.company.name}</Row>
      <Row label="Company ACN">{snapshot.company.acn}</Row>
      <Row label="Address">{snapshot.target.address}</Row>
      <Row label="Chain">
        {snapshot.target.chain} · {snapshot.target.chainId}
      </Row>
      <Row label="Registry">{snapshot.target.registryAddress}</Row>
      <Row label="Approval expiry">{formatDateTime(snapshot.target.expiresAt)}</Row>
      <Row label="Shared nomination">
        {snapshot.source.nomination ? shortReference(snapshot.source.nomination) : 'Removal of a retained target'}
      </Row>
      <Row label="Original ADD target">
        {snapshot.source.targetChange ? shortReference(snapshot.source.targetChange) : 'Not applicable'}
      </Row>
      <Row label="Eligibility request">
        {snapshot.source.request ? shortReference(snapshot.source.request) : 'Not applicable'}
      </Row>
      <Row label="Accepted GENERAL decision">
        {snapshot.source.decision ? shortReference(snapshot.source.decision) : 'Not applicable'}
      </Row>
      <Row label="Possession proof completed">{formatDateTime(snapshot.source.proofCompletedAt)}</Row>
      <Row label="Eligibility expiry">{formatDateTime(snapshot.source.eligibilityExpiresAt)}</Row>
      <Row label="Technical sender">{snapshot.transaction.sender}</Row>
      <Row label="Transaction destination">{snapshot.transaction.to}</Row>
      <Row label="Transaction value">{snapshot.transaction.value}</Row>
      <Row label="Transaction data">{snapshot.transaction.data}</Row>
    </Rows>
  );
}
function Record({
  record,
  data,
  onHeldChange,
}: {
  record: CompanyWalletInstruction;
  data: Read;
  onHeldChange: (uuid: string, held: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      {data.canRead && (
        <>
          <p>
            {COMPANY_WALLET_ACTION_LABELS[record.action]} · {COPY.STAGES[record.stage] ?? record.stage}
          </p>
          <Snapshot snapshot={record.snapshot} />
          <Rows>
            <Row label="Instruction">{shortReference(record.uuid)}</Row>
            <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>
            <Row label="Intent fingerprint">{record.intentDigest}</Row>
            {record.decisions.map((decision) => (
              <Row key={decision.uuid} label={COPY.DECISIONS[decision.kind]}>
                {decision.decidedByName} · {formatDateTime(decision.decidedAt)}
                {decision.reason ? ` · ${decision.reason}` : ''}
              </Row>
            ))}
            {!!record.approvalDecision && (
              <Row label="Consumed approval">{shortReference(record.approvalDecision)}</Row>
            )}
            {!!record.changeId && <Row label="Original wallet change">{shortReference(record.changeId)}</Row>}
            <Row label="Execution">{companyWalletExecutionState(record)}</Row>
            {!!record.execution?.operationId && (
              <Row label="Execution operation">{shortReference(record.execution.operationId)}</Row>
            )}
            {!!record.execution?.claimId && (
              <Row label="Original claim">{shortReference(record.execution.claimId)}</Row>
            )}
            {!!record.execution?.txHash && <Row label="Transaction">{record.execution.txHash}</Row>}
            {!!record.execution?.failureCode && (
              <Row label="Failure">{CHAIN_FAILURE_LABELS[record.execution.failureCode]}</Row>
            )}
          </Rows>
          {refusalSentences(record.executionUnmetRequirements, COMPANY_WALLET_UNMET_COPY).map((sentence) => (
            <p key={sentence} className="text-sm text-text-muted">
              {sentence}
            </p>
          ))}
          <p className="text-sm text-text-muted">
            Human approval and technical execution are recorded separately. Admission is not confirmed chain approval.
          </p>
        </>
      )}
      <RegisterDecisions<CompanyWalletInstruction, CompanyWalletDecisionPreview>
        family={COMPANY_WALLET_DECISIONS}
        copy={COPY}
        noun=""
        proposal={record}
        steps={data.steps}
        guard={data.guard}
        newEffectGuard={(kind) => data.guardInstruction(kind, record)}
        onDecided={data.accept}
        onRefused={data.refresh}
        visible={data.canRead}
        onHeldChange={onHeldChange}
      >
        {(preview) => (
          <>
            <Snapshot snapshot={preview.snapshot} />
            <Rows>
              <Row label="Intent fingerprint">{preview.intentDigest}</Row>
              <Row label="Selected approval">
                {preview.approvalDecision ? shortReference(preview.approvalDecision) : 'Not selected'}
              </Row>
            </Rows>
          </>
        )}
      </RegisterDecisions>
    </div>
  );
}
function Preparation({ data, onEditingChange }: { data: Read; onEditingChange: (editing: boolean) => void }) {
  const { running, track } = useRunningAction();
  const [draft, setDraft] = useState<{
    owner: typeof data.owner;
    action: 'add' | 'remove';
    source: string;
    expires: string;
  }>({ owner: data.owner, action: 'add', source: '', expires: '' });
  const current =
    draft.owner === data.owner ? draft : { owner: data.owner, action: 'add' as const, source: '', expires: '' };
  const { action, source, expires } = current;
  const nominations = data.canRead && data.nominations.isSuccess ? data.nominations.data : [];
  const targets = data.canRead && data.targets.isSuccess ? data.targets.data : [];
  const selected = nominations.find((row) => row.uuid === source);
  const blocked =
    data.busy ||
    !data.canRead ||
    !data.steps.prepare ||
    !!data.original ||
    data.nominations.isFetching ||
    data.targets.isFetching;
  const moment = Date.parse(expires);
  const checks = useErrorSummary({
    source: !source && (action === 'add' ? 'Choose the shared wallet nomination.' : 'Choose the retained ADD target.'),
    expires: action === 'add' && !Number.isFinite(moment) && 'Enter the approval expiry date and time.',
  });
  if (!data.canRead) return null;
  return (
    <div className="space-y-3">
      <ErrorSummary {...checks.summary} />
      <p className="text-sm text-text-muted">
        ADD uses an explicitly shared nomination and finite expiry. REMOVE uses the exact retained successful ADD
        journal, including after wallet or eligibility loss.
      </p>
      <Choices
        legend="Instruction action"
        options={ACTIONS}
        value={action}
        disabled={blocked}
        onChange={(next) => {
          checks.reset();
          onEditingChange(next !== 'add');
          setDraft({ owner: data.owner, action: next, source: '', expires: '' });
        }}
      />
      <SearchSelect
        {...checks.field('source')}
        label={action === 'add' ? 'Explicitly shared wallet nomination' : 'Retained successful ADD target'}
        choices={
          action === 'add'
            ? nominations.map((row) => ({
                value: row.uuid,
                label: row.address,
                detail: row.unmetRequirements.length
                  ? 'Source not ready'
                  : `Proof completed ${formatDateTime(row.proofCompletedAt)}`,
              }))
            : targets.map((row) => ({
                value: row.uuid,
                label: row.address,
                detail: row.expiresAt
                  ? `Approved until ${formatDateTime(row.expiresAt)}`
                  : 'Approved without an expiry',
              }))
        }
        value={source}
        onChange={(uuid) => {
          onEditingChange(!!uuid || !!expires || action !== 'add');
          setDraft({ ...current, source: uuid });
        }}
        placeholder="Type part of a wallet address"
        disabled={blocked}
        noun={WALLETS}
      />
      {selected && (
        <Rows>
          <Row label="Shared address">{selected.address}</Row>
          <Row label="Possession proof completed">{formatDateTime(selected.proofCompletedAt)}</Row>
          <Row label="Maximum eligibility expiry">{formatDateTime(selected.eligibilityExpiresAt)}</Row>
          {refusalSentences(selected.unmetRequirements, COMPANY_WALLET_UNMET_COPY).map((sentence) => (
            <Row key={sentence} label="Current readiness">
              {sentence}
            </Row>
          ))}
        </Rows>
      )}
      {action === 'add' && (
        <Field {...checks.field('expires')} label="Finite approval expiry (local date and time)">
          <TextInput
            type="datetime-local"
            disabled={blocked}
            value={expires}
            onChange={(event) => {
              onEditingChange(!!source || !!event.target.value || action !== 'add');
              setDraft({ ...current, expires: event.target.value });
            }}
          />
        </Field>
      )}
      <FormActions>
        <PageAction
          label="Prepare wallet instruction"
          busy={running === 'prepare'}
          busyLabel="Preparing…"
          disabled={blocked || (action === 'add' && !!selected?.unmetRequirements.length)}
          onClick={() => {
            if (checks.check())
              track(
                'prepare',
                data
                  .prepare(
                    action === 'add'
                      ? { action, nomination: source, expiresAt: new Date(moment).toISOString() }
                      : { action, targetChange: source },
                  )
                  .then((saved) => {
                    if (saved) onEditingChange(false);
                  }),
              );
          }}
        />
      </FormActions>
    </div>
  );
}
export function CompanyWalletInstructions({ active = true }: { active?: boolean }) {
  const [held, setHeld] = useState<{ scope: string; editing: boolean; records: Set<string> } | null>(null);
  const data = useCompanyWalletInstructions({
    newKey: () => crypto.randomUUID(),
    coordinatedReads: true,
    paused: !active,
    pausedScope: held && (held.editing || held.records.size > 0) ? held.scope : undefined,
  });
  const onHeldChange = useCallback(
    (uuid: string, pending: boolean) => {
      setHeld((prior) => {
        const current =
          prior?.scope === data.scopeKey ? prior : { scope: data.scopeKey, editing: false, records: new Set<string>() };
        if (current.records.has(uuid) === pending) return prior;
        const records = new Set(current.records);
        if (pending) records.add(uuid);
        else records.delete(uuid);
        return { ...current, records };
      });
    },
    [data.scopeKey],
  );
  const setEditing = (editing: boolean) =>
    setHeld((prior) => ({
      scope: data.scopeKey,
      editing,
      records: prior?.scope === data.scopeKey ? prior.records : new Set(),
    }));
  useAutomaticReads({
    scope: active && data.owner ? data.scopeKey : null,
    paused: data.readingPaused,
    refresh: data.refresh,
  });
  const { running, track } = useRunningAction();
  const readFailed = data.canRead && (data.nominations.isError || data.targets.isError || data.instructions.isError);
  return (
    <Section title="Company wallet approvals">
      {!data.owner ? (
        <p>Your current account must be checked before opening company wallet instructions.</p>
      ) : (
        <>
          <p className="text-sm text-text-muted">
            Current personal company administration or a register step grants this section. Earlier eligibility evidence
            sharing exposes no wallet directory.
          </p>
          {data.appointments.isError && (
            <LoadError retry={() => track('refresh', data.refresh())} busy={running === 'refresh' || data.busy}>
              Your appointments could not be loaded.
            </LoadError>
          )}
          <CompanyPicker
            label="Wallet approval company"
            companies={data.companies}
            value={data.companyUuid}
            disabled={data.busy || (held?.scope === data.scopeKey && held.records.size > 0)}
            onChange={(uuid) => {
              setEditing(false);
              data.setCompany(uuid);
            }}
          />
          {data.error && (
            <p role="alert" className="text-sm text-error-light">
              {data.error}
            </p>
          )}
          {data.companyUuid && !data.canRead && !data.appointments.isError && (
            <p role="status">
              Current personal register access is required to read these private wallet records. Original requests are
              retained.
            </p>
          )}
          {data.original && (
            <div className="space-y-2">
              <p role="status">The preparation outcome is unconfirmed. Recover the identical original request.</p>
              <Rows>
                <Row label="Original instruction key">{shortReference(data.original.body.operationId)}</Row>
                <Row label="Company">{shortReference(data.original.body.company)}</Row>
                <Row label="Action">{COMPANY_WALLET_ACTION_LABELS[data.original.body.action]}</Row>
                <Row label="Nomination or retained ADD">
                  {shortReference(data.original.body.nomination ?? data.original.body.targetChange ?? '')}
                </Row>
              </Rows>
              <PageAction
                label="Recover original wallet preparation"
                disabled={data.busy}
                onClick={() => void data.recover()}
              />
            </div>
          )}
          {data.companyUuid && <Preparation key={data.scopeKey} data={data} onEditingChange={setEditing} />}
          {readFailed && (
            <LoadError retry={() => track('refresh', data.refresh())} busy={running === 'refresh' || data.busy}>
              The current wallet records could not be {data.instructions.data ? 'refreshed' : 'loaded'}. Original
              receipts remain available for recovery.
            </LoadError>
          )}
          {data.retainedRecords.map((record) => (
            <Record key={`${data.scopeKey}/${record.uuid}`} record={record} data={data} onHeldChange={onHeldChange} />
          ))}
        </>
      )}
    </Section>
  );
}

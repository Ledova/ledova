import { Field, TextInput } from '@components/Field';
import { Choices } from '@components/Choices';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useEntryReads } from '@hooks/useEntryReads';
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
  CHAIN_FAILURE_LABELS,
} from '@ledova/shared';
import { Row, Rows, Section, Status, LoadError } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { SearchSelect } from '@components/SearchSelect';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { STAGE_TONES } from '@pages/company/shared/proposals';
import { TransactionRow } from '@pages/company/shared/TransactionRow';

type Read = ReturnType<typeof useCompanyWalletInstructions>;

const WALLETS = ['wallet', 'wallets'] as const;

const ACTIONS = [
  ['add', COMPANY_WALLET_ACTION_LABELS.add],
  ['remove', COMPANY_WALLET_ACTION_LABELS.remove],
] as const;
function Snapshot({ snapshot }: { snapshot: CompanyWalletInstruction['snapshot'] }) {
  return (
    <>
      <Row label="Wallet">
        <span className="break-all">{snapshot.target.address}</span>
      </Row>
      {snapshot.target.expiresAt && <Row label="Approval expiry">{formatDateTime(snapshot.target.expiresAt)}</Row>}
      {snapshot.source.proofCompletedAt && (
        <Row label="Possession proof completed">{formatDateTime(snapshot.source.proofCompletedAt)}</Row>
      )}
      {snapshot.source.eligibilityExpiresAt && (
        <Row label="Eligibility expiry">{formatDateTime(snapshot.source.eligibilityExpiresAt)}</Row>
      )}
    </>
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
  const context = `${COMPANY_WALLET_ACTION_LABELS[record.action].toLowerCase()} prepared ${formatDateTime(record.createdAt)}`;
  return (
    <li hidden={!data.canRead} className="flex flex-col gap-3 py-4">
      {data.canRead && (
        <>
          <h3 className="font-medium">{COMPANY_WALLET_ACTION_LABELS[record.action]}</h3>
          <Rows>
            <Row label="Stage">
              <Status tone={STAGE_TONES[record.stage] ?? 'waiting'}>{COPY.STAGES[record.stage] ?? record.stage}</Status>
            </Row>
            <Snapshot snapshot={record.snapshot} />
            <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>
            {record.decisions.map((decision) => (
              <Row key={decision.uuid} label={COPY.DECISIONS[decision.kind]}>
                {decision.decidedByName} · {formatDateTime(decision.decidedAt)}
                {decision.reason ? ` · ${decision.reason}` : ''}
              </Row>
            ))}
            <Row label="Execution">{companyWalletExecutionState(record)}</Row>
            {!!record.execution?.txHash && (
              <TransactionRow chain={record.snapshot.target.chain} hash={record.execution.txHash} />
            )}
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
            Approval and the change on chain are recorded separately. An admitted change is confirmed only once it is
            executed on chain.
          </p>
        </>
      )}
      <RegisterDecisions<CompanyWalletInstruction, CompanyWalletDecisionPreview>
        family={COMPANY_WALLET_DECISIONS}
        copy={
          record.action === 'remove'
            ? { ...COPY, CONFIRMATIONS: { ...COPY.CONFIRMATIONS, approve: COPY.REMOVE_CONFIRMATION } }
            : COPY
        }
        noun=""
        proposal={record}
        steps={data.steps}
        guard={data.guard}
        newEffectGuard={(kind) => data.guardInstruction(kind, record)}
        onDecided={data.accept}
        onRefused={data.refresh}
        visible={data.canRead}
        onHeldChange={onHeldChange}
        context={context}
      >
        {(preview) => (
          <Rows>
            <Row label="Action">{COMPANY_WALLET_ACTION_LABELS[record.action]}</Row>
            <Snapshot snapshot={preview.snapshot} />
          </Rows>
        )}
      </RegisterDecisions>
    </li>
  );
}
function Preparation({
  data,
  onEditingChange,
  onClose,
}: {
  data: Read;
  onEditingChange: (editing: boolean) => void;
  onClose: () => void;
}) {
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
    source: !source && (action === 'add' ? 'Choose the shared wallet.' : 'Choose the approved wallet.'),
    expires: action === 'add' && !Number.isFinite(moment) && 'Enter the approval expiry date and time.',
  });
  if (!data.canRead) return null;
  return (
    <div className="space-y-3">
      <ErrorSummary {...checks.summary} />
      <p className="text-sm text-text-muted">
        Approving covers a wallet the participant has shared with the company, until the expiry you set. Removing
        withdraws an earlier approval, even after the wallet or the eligibility has been lost.
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
        label={action === 'add' ? 'Shared wallet' : 'Approved wallet'}
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
        <Field {...checks.field('expires')} label="Approval expiry (local date and time)">
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
          label="Cancel"
          disabled={data.busy}
          onClick={() => {
            onEditingChange(false);
            onClose();
          }}
        />
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
                    if (!saved) return;
                    onEditingChange(false);
                    onClose();
                  }),
              );
          }}
        />
      </FormActions>
    </div>
  );
}
export function CompanyWalletInstructions({ active = true }: { active?: boolean }) {
  const context = useCompanyContext();
  const requestedCompany = new URLSearchParams(useLocation().search).get('company');
  const [held, setHeld] = useState<{ scope: string; editing: boolean; records: Set<string> } | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const data = useCompanyWalletInstructions({
    newKey: () => crypto.randomUUID(),
    coordinatedReads: true,
    paused: !active,
    pausedScope: held && (held.editing || held.records.size > 0) ? held.scope : undefined,
    selectedCompany: context ? (context.companyUuid ?? '') : (requestedCompany ?? ''),
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
  useEntryReads({
    scope: active && data.owner ? data.scopeKey : null,
    paused: data.readingPaused,
    refresh: data.refresh,
  });
  const { running, track } = useRunningAction();
  const readFailed = data.canRead && (data.nominations.isError || data.targets.isError || data.instructions.isError);
  return (
    <Section title="Company wallet approvals">
      {!data.owner ? (
        <p>Your account must be checked before opening wallet approvals.</p>
      ) : (
        <>
          <p className="text-sm text-text-muted">
            Company administrators and people with a ledger step can prepare or decide wallet approvals here. Sharing
            eligibility evidence reveals no wallets.
          </p>
          {data.appointments.isError && (
            <LoadError retry={() => track('refresh', data.refresh())} busy={running === 'refresh' || data.busy}>
              Your appointments could not be loaded.
            </LoadError>
          )}
          {!data.companyUuid ? (
            <CompanyContextNotice />
          ) : context?.companyUuid !== data.companyUuid ? (
            <p className="text-sm text-text-muted">
              {data.companies.find((company) => company.uuid === data.companyUuid)?.name ?? 'Original company'}
            </p>
          ) : null}
          {data.error && (
            <p role="alert" className="text-sm text-error-light">
              {data.error}
            </p>
          )}
          {data.companyUuid && !data.canRead && !data.appointments.isError && (
            <p role="status">
              You need a current ledger appointment for this company to read these wallet records. Earlier requests are
              kept.
            </p>
          )}
          {data.original && (
            <div className="space-y-2">
              <p role="status">The preparation outcome is unconfirmed. Recover the identical original request.</p>
              <Rows>
                <Row label="Action">{COMPANY_WALLET_ACTION_LABELS[data.original.body.action]}</Row>
              </Rows>
              <PageAction
                label="Recover original wallet preparation"
                disabled={data.busy}
                onClick={() => void data.recover()}
              />
            </div>
          )}
          {readFailed && (
            <LoadError retry={() => track('refresh', data.refresh())} busy={running === 'refresh' || data.busy}>
              The current wallet records could not be {data.instructions.data ? 'refreshed' : 'loaded'}. Original
              receipts remain available for recovery.
            </LoadError>
          )}
          {data.retainedRecords.length > 0 ? (
            <ul hidden={!data.canRead} className="divide-y divide-border-subtle">
              {data.retainedRecords.map((record) => (
                <Record
                  key={`${data.scopeKey}/${record.uuid}`}
                  record={record}
                  data={data}
                  onHeldChange={onHeldChange}
                />
              ))}
            </ul>
          ) : (
            data.canRead &&
            data.instructions.isSuccess && (
              <p role="status" className="text-sm text-text-muted">
                No wallet approvals yet.
              </p>
            )
          )}
          {data.companyUuid &&
            data.canRead &&
            (preparing === data.scopeKey ? (
              <Preparation
                key={data.scopeKey}
                data={data}
                onEditingChange={setEditing}
                onClose={() => setPreparing(null)}
              />
            ) : (
              <FormActions>
                <PageAction
                  label="Approve or remove a wallet"
                  disabled={data.busy || !!data.original}
                  onClick={() => setPreparing(data.scopeKey)}
                />
              </FormActions>
            ))}
        </>
      )}
    </Section>
  );
}

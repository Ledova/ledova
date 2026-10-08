import { useState } from 'react';
import {
  useCompanyWalletInstructions,
  COMPANY_WALLET_COPY as COPY,
  COMPANY_WALLET_DECISIONS,
  COMPANY_WALLET_UNMET_COPY,
  companyWalletExecutionState,
  formatDateTime,
  type CompanyWalletInstruction,
  type CompanyWalletDecisionPreview,
} from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { RegisterDecisions } from '../company/register/RegisterDecisions';

type Read = ReturnType<typeof useCompanyWalletInstructions>;
function Snapshot({ snapshot }: { snapshot: CompanyWalletInstruction['snapshot'] }) {
  return (
    <Rows>
      <Row label="Company">
        {snapshot.company.name} · {snapshot.company.uuid}
      </Row>
      <Row label="Company ACN">{snapshot.company.acn}</Row>
      <Row label="Address">{snapshot.target.address}</Row>
      <Row label="Chain">
        {snapshot.target.chain} · {snapshot.target.chainId}
      </Row>
      <Row label="Registry">{snapshot.target.registryAddress}</Row>
      <Row label="Approval expiry">{formatDateTime(snapshot.target.expiresAt)}</Row>
      <Row label="Shared nomination">{snapshot.source.nomination ?? 'Removal of a retained target'}</Row>
      <Row label="Original ADD target">{snapshot.source.targetChange ?? 'Not applicable'}</Row>
      <Row label="Eligibility request">{snapshot.source.request ?? 'Not applicable'}</Row>
      <Row label="Accepted GENERAL decision">{snapshot.source.decision ?? 'Not applicable'}</Row>
      <Row label="Possession proof completed">{formatDateTime(snapshot.source.proofCompletedAt)}</Row>
      <Row label="Eligibility expiry">{formatDateTime(snapshot.source.eligibilityExpiresAt)}</Row>
      <Row label="Technical sender">{snapshot.transaction.sender}</Row>
      <Row label="Transaction destination">{snapshot.transaction.to}</Row>
      <Row label="Transaction value">{snapshot.transaction.value}</Row>
      <Row label="Transaction data">{snapshot.transaction.data}</Row>
    </Rows>
  );
}
function Record({ record, data }: { record: CompanyWalletInstruction; data: Read }) {
  return (
    <div className="space-y-3">
      {data.canRead && (
        <>
          <p>
            {record.action} · {COPY.STAGES[record.stage] ?? record.stage}
          </p>
          <Snapshot snapshot={record.snapshot} />
          <Rows>
            <Row label="Instruction">{record.uuid}</Row>
            <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>
            <Row label="Intent fingerprint">{record.intentDigest}</Row>
            {record.decisions.map((decision) => (
              <Row key={decision.uuid} label={COPY.DECISIONS[decision.kind]}>
                {decision.decidedByName} · {formatDateTime(decision.decidedAt)}
                {decision.reason ? ` · ${decision.reason}` : ''}
              </Row>
            ))}
            {!!record.approvalDecision && <Row label="Consumed approval">{record.approvalDecision}</Row>}
            {!!record.changeId && <Row label="Original wallet change">{record.changeId}</Row>}
            <Row label="Execution">{companyWalletExecutionState(record)}</Row>
            {!!record.execution?.operationId && <Row label="Execution operation">{record.execution.operationId}</Row>}
            {!!record.execution?.claimId && <Row label="Original claim">{record.execution.claimId}</Row>}
            {!!record.execution?.txHash && <Row label="Transaction">{record.execution.txHash}</Row>}
            {!!record.execution?.failureCode && <Row label="Failure">{record.execution.failureCode}</Row>}
          </Rows>
          {record.executionUnmetRequirements.map((code) => (
            <p key={code} className="text-sm text-text-muted">
              {COMPANY_WALLET_UNMET_COPY[code] ?? code}
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
      >
        {(preview) => (
          <>
            <Snapshot snapshot={preview.snapshot} />
            <Rows>
              <Row label="Intent fingerprint">{preview.intentDigest}</Row>
              <Row label="Selected approval">{preview.approvalDecision ?? 'Not selected'}</Row>
            </Rows>
          </>
        )}
      </RegisterDecisions>
    </div>
  );
}
function Preparation({ data }: { data: Read }) {
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
  const valid = source && (action === 'remove' || Number.isFinite(moment));
  if (!data.canRead) return null;
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        ADD uses an explicitly shared nomination and finite expiry. REMOVE uses the exact retained successful ADD
        journal, including after wallet or eligibility loss.
      </p>
      <label className="text-sm">
        Instruction action
        <select
          aria-label="Wallet instruction action"
          className={FIELD_CLASS}
          disabled={blocked}
          value={action}
          onChange={(event) =>
            setDraft({ owner: data.owner, action: event.target.value as 'add' | 'remove', source: '', expires: '' })
          }
        >
          <option value="add">Approve nominated wallet</option>
          <option value="remove">Remove retained approval</option>
        </select>
      </label>
      <label className="text-sm">
        {action === 'add' ? 'Explicitly shared wallet nomination' : 'Retained successful ADD target'}
        <select
          aria-label="Wallet instruction target"
          className={FIELD_CLASS}
          disabled={blocked}
          value={source}
          onChange={(event) => setDraft({ ...current, source: event.target.value })}
        >
          <option value="">Select exact target</option>
          {action === 'add'
            ? nominations.map((row) => (
                <option key={row.uuid} value={row.uuid}>
                  {row.address} · {row.uuid}
                  {row.unmetRequirements.length ? ' · source not ready' : ''}
                </option>
              ))
            : targets.map((row) => (
                <option key={row.uuid} value={row.uuid}>
                  {row.address} · {row.uuid} · {row.status}
                </option>
              ))}
        </select>
      </label>
      {selected && (
        <Rows>
          <Row label="Shared address">{selected.address}</Row>
          <Row label="Possession proof completed">{formatDateTime(selected.proofCompletedAt)}</Row>
          <Row label="Maximum eligibility expiry">{formatDateTime(selected.eligibilityExpiresAt)}</Row>
          {selected.unmetRequirements.map((code) => (
            <Row key={code} label="Current readiness">
              {COMPANY_WALLET_UNMET_COPY[code] ?? code}
            </Row>
          ))}
        </Rows>
      )}
      {action === 'add' && (
        <label className="text-sm">
          Finite approval expiry (local date and time)
          <input
            aria-label="Wallet approval expiry"
            type="datetime-local"
            className={FIELD_CLASS}
            disabled={blocked}
            value={expires}
            onChange={(event) => setDraft({ ...current, expires: event.target.value })}
          />
        </label>
      )}
      <PageAction
        label="Prepare wallet instruction"
        disabled={blocked || !valid || (action === 'add' && !!selected?.unmetRequirements.length)}
        onClick={() =>
          void data.prepare(
            action === 'add'
              ? { action, nomination: source, expiresAt: new Date(moment).toISOString() }
              : { action, targetChange: source },
          )
        }
      />
    </div>
  );
}
export function CompanyWalletInstructions() {
  const data = useCompanyWalletInstructions(apiClient, { newKey: () => crypto.randomUUID() });
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
          <label className="text-sm">
            Wallet approval company
            <select
              aria-label="Wallet approval company"
              className={FIELD_CLASS}
              value={data.companyUuid}
              disabled={data.busy}
              onChange={(event) => data.setCompany(event.target.value)}
            >
              <option value="">Select company</option>
              {data.companies.map((row) => (
                <option key={row.uuid} value={row.uuid}>
                  {row.name} · {row.uuid}
                </option>
              ))}
            </select>
          </label>
          {data.companyUuid && (
            <PageAction
              label="Refresh company wallet instructions"
              disabled={data.busy}
              onClick={() => void data.refresh()}
            />
          )}
          {data.error && (
            <p role="alert" className="text-sm text-error-light">
              {data.error}
            </p>
          )}
          {data.companyUuid && !data.canRead && (
            <p role="status">
              Refresh current personal register access before reading these private wallet records. Original requests
              are retained.
            </p>
          )}
          {data.original && (
            <div className="space-y-2">
              <p role="status">The preparation outcome is unconfirmed. Recover the identical original request.</p>
              <Rows>
                <Row label="Original instruction key">{data.original.body.operationId}</Row>
                <Row label="Company">{data.original.body.company}</Row>
                <Row label="Action">{data.original.body.action}</Row>
                <Row label="Nomination or retained ADD">
                  {data.original.body.nomination ?? data.original.body.targetChange}
                </Row>
              </Rows>
              <PageAction
                label="Recover original wallet preparation"
                disabled={data.busy}
                onClick={() => void data.recover()}
              />
            </div>
          )}
          {data.companyUuid && <Preparation key={data.scopeKey} data={data} />}
          {data.canRead && (data.nominations.isError || data.targets.isError || data.instructions.isError) && (
            <p role="alert">
              The current wallet records could not be refreshed. Original receipts remain available for recovery.
            </p>
          )}
          {data.retainedRecords.map((record) => (
            <Record key={`${data.scopeKey}/${record.uuid}`} record={record} data={data} />
          ))}
        </>
      )}
    </Section>
  );
}

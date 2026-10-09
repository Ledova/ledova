import { useEffect, useRef, useState } from 'react';
import {
  useCompanyPaidIssues,
  REGISTER_PAID_ISSUE_COPY as COPY,
  REGISTER_PAID_ISSUE_DECISIONS,
  REGISTER_PAID_ISSUE_UNMET_COPY,
  isRegisterEvidenceReceipt,
  uploadRegisterEvidence,
  downloadRegisterPaidIssueFile,
  failureStatus,
  formatDateTime,
  formatMoney,
  formatShareCount,
  type RegisterPaidIssueSource,
  getErrorMessage,
  registerPaidIssueExecutionState,
  type RegisterEvidence,
  type RegisterPaidIssue,
} from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { RegisterDecisions } from '../register/RegisterDecisions';
import { saveFile } from '../register/useCompanyRegister';
import { DecisionTrail } from '../register/DecisionTrail';
import type { useShareClass } from './useShareClass';

type Commands = ReturnType<typeof useCompanyPaidIssues>;
const STAGES: Record<string, string> = COPY.STAGES;

function SourceRows({ source }: { source: RegisterPaidIssueSource }) {
  return (
    <Rows>
      <Row label="Subscription">{source.subscription}</Row>
      <Row label="Offering">{source.offering}</Row>
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
      <Row label="Payment received date">{source.paymentReceivedOn || 'Not recorded'}</Row>
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

function PaidIssueRecord({ record, commands }: { record: RegisterPaidIssue; commands: Commands }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      commands.guard();
      const response = await downloadRegisterPaidIssueFile(apiClient, record.uuid, commands.config(commands.guard));
      commands.guard();
      saveFile(response.data, `paid-issue-authority-${record.uuid}`);
    } catch (failure) {
      setError(
        getErrorMessage(failure, 'The retained authority copy could not be downloaded.') ??
          'The request could not be confirmed.',
      );
    } finally {
      setBusy(false);
    }
  };
  const execution = record.execution;
  return (
    <div className="space-y-3 border-t border-border py-4">
      {commands.visible && (
        <>
          <h3 className="font-medium">{STAGES[record.stage] ?? record.stage} paid issue</h3>
          <SnapshotRows record={record} />
          <Rows>
            <Row label="Preparation ID">{record.uuid}</Row>
            <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>

            <Row label="Intent fingerprint">{record.intentDigest}</Row>
            {record.approvalDecision && <Row label="Consumed approval">{record.approvalDecision}</Row>}
            <Row label="Execution">{registerPaidIssueExecutionState(record)}</Row>
            <Row label="Original subscription status">{record.subscriptionStatus}</Row>
            <Row label="Actual allotment recorded">
              {record.allottedAt ? formatDateTime(record.allottedAt) : 'Not recorded'}
            </Row>
            <Row label="Original issuance request">{record.request || 'No issuance request admitted'}</Row>
            {execution && (
              <>
                <Row label="Original execution">{execution.execution}</Row>
                <Row label="Original dispatch">{execution.dispatchId}</Row>
                {execution.operationId && <Row label="Original operation">{execution.operationId}</Row>}
                {execution.claimId && <Row label="Original claim">{execution.claimId}</Row>}
                {execution.txHash && <Row label="Transaction hash">{execution.txHash}</Row>}
                {execution.blockNumber !== null && <Row label="Original receipt block">{execution.blockNumber}</Row>}
                {execution.blockHash && <Row label="Original receipt block hash">{execution.blockHash}</Row>}
                <Row label="Original completion date">
                  {execution.completedAt ? formatDateTime(execution.completedAt) : 'Not recorded'}
                </Row>
                <Row label="Original issuance">{execution.issuance || 'Not recorded'}</Row>
                <Row label="Register entry">{execution.registerEntry || 'Not recorded'}</Row>
                <Row label="Entry effective date">{execution.effectiveOn || 'Not recorded'}</Row>
              </>
            )}
          </Rows>
          <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
          <DecisionTrail proposal={record} labels={COPY.DECISIONS} />
          <p className="text-sm text-text-muted">{COPY.ADMITTED_NOTE}</p>
          {record.executionUnmetRequirements.map((code) => (
            <p key={code} className="text-sm text-text-muted">
              {REGISTER_PAID_ISSUE_UNMET_COPY[code] ?? code}
            </p>
          ))}
          <PageAction
            label="Download paid issue authority"
            context={`paid issue ${record.uuid}`}
            disabled={busy}
            onClick={() => void download()}
          />
          {error && <p role="alert">{error}</p>}
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
        context={`paid issue ${record.uuid}`}
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
  const [captured, setCaptured] = useState<Parameters<Commands['prepare']>[1] | null>(null);
  const [director, setDirector] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const upload = useRef<{ file: File; appointment: string; key: string; receipt: RegisterEvidence | null } | null>(
    null,
  );
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const termsValid =
    !!captured &&
    !!director.trim() &&
    director.trim().length <= 255 &&
    !!reference.trim() &&
    reference.trim().length <= 255 &&
    !!reason.trim() &&
    reason.trim().length <= 1000;
  const waiting = busy || commands.busy;
  const check = () => {
    if (!mounted.current || !captured) throw new Error('Choose an exact recorded paid subscription.');
    commands.guardPaidIssue('prepare', captured);
  };
  const select = (subscription: string) => {
    try {
      const source = commands.availableSubscriptions.data?.find((row) => row.subscription === subscription);
      if (!source) throw new Error('Choose an available recorded paid subscription.');
      const next = { source: { ...source }, token: commands.source ? { ...commands.source } : undefined };
      commands.guardPaidIssue('prepare', next);
      setCaptured(next);
      upload.current = null;
      setFile(null);
      setError('');
    } catch (failure) {
      setError(
        getErrorMessage(failure, 'The paid source could not be selected.') ?? 'The source could not be confirmed.',
      );
    }
  };
  const submit = async () => {
    if (waiting || !commands.canPrepare || commands.recovery || !termsValid || !file || !captured) return;
    setBusy(true);
    setError('');
    try {
      check();
      const appointment = commands.steps.prepare!.uuid;
      const prior = upload.current;
      const same = prior?.file === file && prior.appointment === appointment;
      const key = same ? prior.key : crypto.randomUUID();
      let receipt = same ? prior.receipt : null;
      if (!receipt) {
        upload.current = { file, appointment, key, receipt: null };
        const body = { companyId: commands.company, appointment, kind: 'authority' as const, idempotencyKey: key };
        const response = await uploadRegisterEvidence(apiClient, { ...body, file }, commands.config(check));
        check();
        if (!isRegisterEvidenceReceipt(response.data, body, file.size))
          throw new Error('The exact company authority receipt could not be confirmed.');
        receipt = response.data;
        upload.current = { file, appointment, key, receipt };
      }
      check();
      await commands.prepare(
        {
          subscription: captured.source.subscription,
          approvingDirector: director.trim(),
          authorityReference: reference.trim(),
          reason: reason.trim(),
          authorityEvidence: receipt.uuid,
        },
        captured,
      );
    } catch (failure) {
      if (failureStatus(failure) === 409) upload.current = null;
      try {
        commands.guard();
        if (mounted.current)
          setError(
            getErrorMessage(failure, 'The paid issue could not be prepared.') ?? 'The request could not be confirmed.',
          );
      } catch {
        return;
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const candidates = commands.availableSubscriptions.data ?? [];
  return (
    <fieldset disabled={waiting} className="space-y-4">
      <h3 className="font-medium">Prepare a company paid issue</h3>
      <p className="text-sm text-text-muted">{COPY.PAYMENT_NOTE}</p>
      {commands.availableSubscriptions.isPending && <p role="status">Loading recorded paid sources…</p>}
      {commands.availableSubscriptions.isError && (
        <p role="alert">
          Available paid subscription sources could not be refreshed. The captured draft remains, and fresh evidence is
          blocked.
        </p>
      )}
      {commands.availableSubscriptions.isSuccess &&
        !commands.availableSubscriptions.isFetching &&
        candidates.length === 0 && (
          <p className="text-sm text-text-muted">
            No available paid subscription for this class. Existing admitted sources retain their original outcomes.
          </p>
        )}
      <label className="block text-sm">
        Recorded paid subscription
        <select
          className={FIELD_CLASS}
          value={captured?.source.subscription ?? ''}
          onChange={(event) => select(event.target.value)}
        >
          <option value="">Choose an available recorded paid source</option>
          {captured && !candidates.some((row) => row.subscription === captured.source.subscription) && (
            <option value={captured.source.subscription}>Captured source {captured.source.subscription}</option>
          )}
          {candidates.map((row) => (
            <option key={row.subscription} value={row.subscription}>
              {row.subscription} · {formatShareCount(row.shares)} shares · {row.recipientAddress}
            </option>
          ))}
        </select>
      </label>
      {captured && <SourceRows source={captured.source} />}
      <PageAction
        label="Use current recorded source"
        disabled={!commands.canPrepare || !captured}
        onClick={() => {
          if (captured) select(captured.source.subscription);
        }}
      />
      <label className="block text-sm">
        Approving director
        <input
          className={FIELD_CLASS}
          maxLength={255}
          value={director}
          onChange={(event) => setDirector(event.target.value)}
        />
      </label>
      <p className="text-sm text-text-muted">
        The company names a director other than the recipient. No director account is required.
      </p>
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
        Paid issue reason
        <textarea
          className={FIELD_CLASS}
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        Paid issue authority document
        <input
          className={FIELD_CLASS}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          disabled={!commands.canPrepare || !termsValid}
          onClick={(event) => {
            try {
              check();
            } catch (failure) {
              event.preventDefault();
              setError(
                getErrorMessage(failure, 'The authority picker is unavailable.') ??
                  'The source could not be confirmed.',
              );
            }
          }}
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
              upload.current = null;
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
        label={busy ? 'Preparing…' : 'Prepare paid issue'}
        disabled={waiting || !commands.canPrepare || !!commands.recovery || !termsValid || !file}
        onClick={() => void submit()}
      />
    </fieldset>
  );
}

export function CompanyPaidIssueFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useShareClass> }) {
  const commands = useCompanyPaidIssues(apiClient, uuid, {
    token: data.token.data,
    tokenKey: data.tokenKey,
    newKey: () => crypto.randomUUID(),
  });
  if (!commands.owner) return null;
  return (
    <Section title={COPY.TITLE}>
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
      <PageAction
        label="Refresh company paid issue records"
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
          You can read company paid issue history. Preparation requires current company administration or prepare
          capability.
        </p>
      )}
      {commands.visible && commands.instructions.isPending && <p role="status">Loading company paid issue records…</p>}
      {commands.visible && commands.instructions.isError && (
        <p role="alert">The paid issue records could not be refreshed. Retained original receipts remain available.</p>
      )}
      {!!commands.company && (
        <div hidden={!commands.visible || !commands.steps.prepare}>
          <Preparation key={commands.scopeKey} commands={commands} />
        </div>
      )}
      {commands.visible && commands.recovery && (
        <div className="space-y-2">
          <p className="text-sm text-text-muted">
            The original paid issue preparation response is unresolved. Recover its identical body and operation UUID.
          </p>
          <p>{commands.recovery.body.operationId}</p>
          <PageAction
            label="Recover original paid issue preparation receipt"
            disabled={commands.busy}
            onClick={() => void commands.recover()}
          />
        </div>
      )}
      {commands.visible && commands.error && <p role="alert">{commands.error}</p>}
      {commands.records.map((record) => (
        <PaidIssueRecord key={record.uuid} record={record} commands={commands} />
      ))}
    </Section>
  );
}

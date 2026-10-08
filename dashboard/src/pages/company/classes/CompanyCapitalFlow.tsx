import { useEffect, useRef, useState } from 'react';
import {
  useCompanyCapitalIncreases,
  REGISTER_CAPITAL_INCREASE_COPY as COPY,
  REGISTER_CAPITAL_INCREASE_DECISIONS,
  REGISTER_CAPITAL_INCREASE_UNMET_COPY,
  isRegisterEvidenceReceipt,
  uploadRegisterEvidence,
  downloadRegisterCapitalIncreaseFile,
  failureStatus,
  formatShareCount,
  formatDateTime,
  getErrorMessage,
  raisedSupply,
  requestShares,
  registerCapitalIncreaseExecutionState,
  type RegisterEvidence,
  type RegisterCapitalIncrease,
  type RegisterCapitalIncreaseSnapshot,
} from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { RegisterDecisions } from '../register/RegisterDecisions';
import { saveFile } from '../register/useCompanyRegister';
import { DecisionTrail } from '../register/DecisionTrail';
import type { useShareClass } from './useShareClass';

type Commands = ReturnType<typeof useCompanyCapitalIncreases>;
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      commands.guard();
      const response = await downloadRegisterCapitalIncreaseFile(
        apiClient,
        record.uuid,
        commands.config(commands.guard),
      );
      commands.guard();
      saveFile(response.data, `capital-authority-${record.uuid}`);
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
          <h3 className="font-medium">{STAGES[record.stage] ?? record.stage} capital increase</h3>
          <SnapshotRows snapshot={record.snapshot} />
          <Rows>
            <Row label="Preparation ID">{record.uuid}</Row>
            <Row label="Prepared by">{record.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(record.createdAt)}</Row>
            <Row label="Original request">{record.request}</Row>
            <Row label="Intent fingerprint">{record.intentDigest}</Row>
            {record.approvalDecision && <Row label="Consumed approval">{record.approvalDecision}</Row>}
            <Row label="Execution">{registerCapitalIncreaseExecutionState(record)}</Row>
            {execution && (
              <>
                <Row label="Original execution">{execution.execution}</Row>
                <Row label="Dispatch">{execution.dispatchId}</Row>
                {execution.operationId && <Row label="Original operation">{execution.operationId}</Row>}
                {execution.claimId && <Row label="Original claim">{execution.claimId}</Row>}
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
          {record.executionUnmetRequirements.map((code) => (
            <p key={code} className="text-sm text-text-muted">
              {REGISTER_CAPITAL_INCREASE_UNMET_COPY[code] ?? code}
            </p>
          ))}
          <PageAction
            label="Download capital authority"
            context={`capital ${record.uuid}`}
            disabled={busy}
            onClick={() => void download()}
          />
          {error && <p role="alert">{error}</p>}
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
        context={`capital ${record.uuid}`}
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
  const [before, setBefore] = useState(() => commands.source?.totalSupply ?? '');
  const [additional, setAdditional] = useState('');
  const [purpose, setPurpose] = useState('');
  const [board, setBoard] = useState('');
  const [shareholder, setShareholder] = useState('');
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
  const additionalShares = requestShares(additional);
  const total = raisedSupply(before, additional);
  const newAuthorizedTotal = total === null ? null : requestShares(total);
  const valid =
    additionalShares !== null &&
    newAuthorizedTotal !== null &&
    !!purpose.trim() &&
    !!board.trim() &&
    board.trim().length <= 255 &&
    shareholder.trim().length <= 255 &&
    !!file;
  const waiting = busy || commands.busy;
  const submit = async () => {
    if (waiting || !commands.canPrepare || commands.recovery || !valid) return;
    setBusy(true);
    setError('');
    const check = () => {
      if (!mounted.current) throw new Error('This capital form is closed.');
      commands.guardCapital('prepare', {
        priorAuthorizedTotal: before,
        additionalShares: additionalShares!,
        newAuthorizedTotal: newAuthorizedTotal!,
      });
    };
    try {
      check();
      const appointment = commands.steps.prepare!.uuid;
      const prior = upload.current;
      const same = prior?.file === file && prior.appointment === appointment;
      const key = same ? prior.key : crypto.randomUUID();
      let receipt = same ? prior.receipt : null;
      if (!receipt) {
        upload.current = { file: file!, appointment, key, receipt: null };
        const body = { companyId: commands.company, appointment, kind: 'authority' as const, idempotencyKey: key };
        const response = await uploadRegisterEvidence(apiClient, { ...body, file: file! }, commands.config(check));
        check();
        if (!isRegisterEvidenceReceipt(response.data, body, file!.size))
          throw new Error('The exact company authority receipt could not be confirmed.');
        receipt = response.data;
        upload.current = { file: file!, appointment, key, receipt };
      }
      check();
      await commands.prepare(
        {
          additionalShares: additionalShares!,
          newAuthorizedTotal: newAuthorizedTotal!,
          purpose: purpose.trim(),
          boardResolutionReference: board.trim(),
          shareholderApprovalReference: shareholder.trim(),
          authorityEvidence: receipt.uuid,
        },
        before,
      );
    } catch (failure) {
      if (failureStatus(failure) === 409) upload.current = null;
      try {
        commands.guard();
        if (mounted.current)
          setError(
            getErrorMessage(failure, 'The capital increase could not be prepared.') ??
              'The request could not be confirmed.',
          );
      } catch {
        return;
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <fieldset disabled={waiting} className="space-y-4">
      <h3 className="font-medium">Prepare a company capital increase</h3>
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
      <label className="block text-sm">
        Additional authorised shares
        <input
          className={FIELD_CLASS}
          inputMode="numeric"
          value={additional}
          onChange={(event) => setAdditional(event.target.value)}
        />
      </label>
      {total !== null && <p className="text-sm">New authorised cap: {formatShareCount(total)}</p>}
      {additional !== '' && (additionalShares === null || newAuthorizedTotal === null) && (
        <p role="alert">Enter positive whole shares with an exact new cap no greater than 2,147,483,647.</p>
      )}
      <label className="block text-sm">
        Purpose
        <textarea className={FIELD_CLASS} value={purpose} onChange={(event) => setPurpose(event.target.value)} />
      </label>
      <label className="block text-sm">
        Board resolution reference
        <input
          className={FIELD_CLASS}
          maxLength={255}
          value={board}
          onChange={(event) => setBoard(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        Shareholder approval reference (optional)
        <input
          className={FIELD_CLASS}
          maxLength={255}
          value={shareholder}
          onChange={(event) => setShareholder(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        Capital authority document
        <input
          className={FIELD_CLASS}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          onChange={(event) => {
            const chosen = event.target.files?.[0] ?? null;
            if (
              chosen &&
              (!['application/pdf', 'image/png', 'image/jpeg'].includes(chosen.type) ||
                chosen.size <= 0 ||
                chosen.size > 10 * 1024 * 1024)
            ) {
              setError('Choose a PDF, PNG or JPEG of up to 10 MB.');
              return;
            }
            upload.current = null;
            setFile(chosen);
            setError('');
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <PageAction
        label={busy ? 'Preparing…' : 'Prepare capital increase'}
        disabled={waiting || !commands.canPrepare || !!commands.recovery || !valid}
        onClick={() => void submit()}
      />
    </fieldset>
  );
}

export function CompanyCapitalFlow({ uuid, data }: { uuid: string; data: ReturnType<typeof useShareClass> }) {
  const commands = useCompanyCapitalIncreases(apiClient, uuid, {
    token: data.token.data,
    tokenKey: data.tokenKey,
    newKey: () => crypto.randomUUID(),
  });
  if (!commands.owner) return null;
  return (
    <Section title={COPY.TITLE}>
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
      <PageAction
        label="Refresh company capital records"
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
          You can read company capital history. Preparation requires current company administration or prepare
          capability.
        </p>
      )}
      {commands.visible && commands.instructions.isPending && <p role="status">Loading company capital records…</p>}
      {commands.visible && commands.instructions.isError && (
        <p role="alert">The capital records could not be refreshed. Retained original receipts remain available.</p>
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
          <p>{commands.recovery.body.operationId}</p>
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

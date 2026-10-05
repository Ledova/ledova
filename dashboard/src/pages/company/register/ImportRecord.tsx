import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  REGISTER_COPY,
  REGISTER_IMPORT_COPY,
  REGISTER_IMPORT_DECISIONS,
  REGISTER_IMPORT_UNMET_COPY,
  apiErrorSentence,
  downloadRegisterImportFile,
  formatDateTime,
  formatShareCount,
  registerImportTotals,
  useRegisterDecision,
  type RegisterDecisionKind,
  type RegisterImport,
  type RegisterImportDecisionPreview,
} from '@ledova/shared';
import { Row, Rows, Status } from '@components/Ledger';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { DecisionTrail } from './DecisionTrail';
import { DOWNLOAD_FAILED, STAGE_TONES, STEP_CHANGED, retainedName, type RegisterSteps } from './proposals';
import { saveFile } from './useCompanyRegister';

type Decision = ReturnType<typeof useRegisterDecision<RegisterImport, RegisterImportDecisionPreview>>;

const KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];

function DecisionPanel({
  kind,
  decision,
  current,
  reason,
  onReason,
  onPreview,
}: {
  kind: RegisterDecisionKind;
  decision: Decision;
  current: boolean;
  reason: string;
  onReason: (value: string) => void;
  onPreview: () => void;
}) {
  const preview = decision.target?.preview;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-primary">{REGISTER_IMPORT_COPY.CONFIRMATIONS[kind]}</p>
      {kind === 'reject' && (
        <>
          <label className="block space-y-1 text-sm text-text-primary">
            {REGISTER_IMPORT_COPY.REJECTION_REASON}
            <textarea
              className={FIELD_CLASS}
              rows={3}
              maxLength={1000}
              value={reason}
              disabled={decision.busy}
              onChange={(event) => onReason(event.target.value)}
            />
          </label>
          <PageAction
            label="Preview the rejection"
            disabled={decision.busy || !reason.trim() || decision.target?.request.reason === reason.trim()}
            onClick={onPreview}
          />
        </>
      )}
      {decision.error && (
        <p role="alert" className="text-sm text-error-light">
          {decision.error}
        </p>
      )}
      {preview && !current && (
        <p role="alert" className="text-sm text-error-light">
          {STEP_CHANGED}
        </p>
      )}
      {decision.busy && !preview && (
        <p role="status" className="text-sm text-text-muted">
          Loading the preview…
        </p>
      )}
      {preview && (
        <>
          {kind === 'apply' && preview.opensRegister && (
            <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.NOT_ON_CHAIN_NOTE}</p>
          )}
          {preview.unmetRequirements.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-text-muted">This decision cannot be recorded yet:</p>
              <ul className="flex flex-col gap-1 text-sm text-text-primary">
                {preview.unmetRequirements.map((code) => (
                  <li key={code}>{REGISTER_IMPORT_UNMET_COPY[code] ?? code}</li>
                ))}
              </ul>
            </div>
          )}
          {preview.statedTotal !== null && preview.statedMemberCount !== null && (
            <p className="text-sm text-text-primary">
              {REGISTER_IMPORT_COPY.STATED_FIGURES(formatShareCount(preview.statedTotal), preview.statedMemberCount)}
            </p>
          )}
          <p className="text-sm text-text-primary">
            {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(
              formatShareCount(preview.importedTotal),
              preview.importedMemberCount,
            )}
          </p>
          <h3 className="text-sm font-medium text-text-primary">Members compared with the stored register</h3>
          <ul className="divide-y divide-border-subtle">
            {preview.comparison.map((row) => (
              <li key={row.member} className="py-2">
                <Rows>
                  <Row label="Imported name">{row.name ?? 'Not in the import'}</Row>
                  <Row label="Imported shares">
                    <span className="break-all">
                      {row.imported === null ? 'Not in the import' : formatShareCount(row.imported)}
                    </span>
                  </Row>
                  <Row label="Stored shares">
                    <span className="break-all">
                      {row.stored === null ? 'Not stored' : formatShareCount(row.stored)}
                    </span>
                  </Row>
                  <Row label="Imported date entered">{row.importedEnteredOn ?? 'Not in the import'}</Row>
                  <Row label="Stored date entered">{row.enteredOn ?? 'Not stored'}</Row>
                  <Row label="Live name">{row.liveName ?? 'No live identity'}</Row>
                  {row.liveAddress && <Row label="Live address">{row.liveAddress}</Row>}
                  <Row label="Wallets">
                    <span className="break-all">
                      {row.wallets.length > 0 ? row.wallets.join(', ') : REGISTER_COPY.NO_WALLET}
                    </span>
                  </Row>
                </Rows>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function ImportRecord({
  proposal,
  steps,
  guard,
  onDecided,
  onRefused,
}: {
  proposal: RegisterImport;
  steps: RegisterSteps;
  guard: () => void;
  onDecided: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
}) {
  const [active, setActive] = useState<RegisterDecisionKind | null>(null);
  const [reason, setReason] = useState('');
  const options = (kind: RegisterDecisionKind) => ({
    appointment: steps[kind]?.uuid,
    newKey: () => crypto.randomUUID(),
    guard,
    requestConfig: () => ({ ledovaSubmissionGuard: guard }),
    onDecided: async () => {
      setActive(null);
      await onDecided();
    },
    onRefused,
  });
  const approve = useRegisterDecision(apiClient, REGISTER_IMPORT_DECISIONS, proposal, options('approve'));
  const apply = useRegisterDecision(apiClient, REGISTER_IMPORT_DECISIONS, proposal, options('apply'));
  const reject = useRegisterDecision(apiClient, REGISTER_IMPORT_DECISIONS, proposal, options('reject'));
  const decisions = { approve, apply, reject };
  const decision = active ? decisions[active] : null;
  const busy = approve.busy || apply.busy || reject.busy;
  const download = useMutation({
    mutationFn: async (copy: 'register' | 'asic') => {
      guard();
      const { data } = await downloadRegisterImportFile(apiClient, proposal.uuid, copy, {
        ledovaSubmissionGuard: guard,
      });
      guard();
      saveFile(
        data,
        copy === 'asic'
          ? retainedName(proposal.asicSnapshot, `asic-extract-${proposal.uuid}`)
          : retainedName(proposal.evidenceSnapshot, `register-import-${proposal.uuid}`),
      );
    },
  });
  const totals = registerImportTotals(proposal.members);
  const kinds: RegisterDecisionKind[] = proposal.providedBy === 'company' ? KINDS : ['reject'];
  const available = proposal.status === 'submitted' ? kinds.filter((kind) => steps[kind]) : [];
  const target = decision?.target;
  const current = !!active && !!target && steps[active]?.uuid === target.request.appointment;
  const ready =
    !!decision &&
    !decision.busy &&
    !!target &&
    current &&
    target.preview.canDecide &&
    (active !== 'reject' || target.request.reason === reason.trim());
  const begin = (kind: RegisterDecisionKind) => {
    if (active || busy) return;
    setReason('');
    setActive(kind);
    void decisions[kind].open(kind);
  };
  const close = () => {
    if (decision?.busy) return;
    decision?.cancel();
    setActive(null);
  };
  return (
    <li className="flex flex-col gap-3 py-4">
      <Rows>
        <Row label="Stage">
          <Status tone={STAGE_TONES[proposal.stage] ?? 'waiting'}>
            {REGISTER_IMPORT_COPY.STAGES[proposal.stage] ?? proposal.stage}
          </Status>
        </Row>
        {proposal.preparedByName !== null && <Row label="Prepared by">{proposal.preparedByName || 'Not provided'}</Row>}
        <Row label="Prepared on">{formatDateTime(proposal.createdAt)}</Row>
        <Row label="Register date">{proposal.asAt}</Row>
        <DecisionTrail proposal={proposal} labels={REGISTER_IMPORT_COPY.DECISIONS} />
      </Rows>
      <p className="text-sm text-text-muted">
        {proposal.providedBy === 'company'
          ? REGISTER_IMPORT_COPY.PROVIDED_BY_COMPANY
          : REGISTER_IMPORT_COPY.STAFF_VERIFIED}
      </p>
      {proposal.asicIssuedTotal !== null && proposal.asicMemberCount !== null && (
        <p className="text-sm text-text-primary">
          {REGISTER_IMPORT_COPY.STATED_FIGURES(formatShareCount(proposal.asicIssuedTotal), proposal.asicMemberCount)}
        </p>
      )}
      <p className="text-sm text-text-primary">
        {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(totals.total), totals.count)}
      </p>
      <div className="flex flex-wrap gap-2">
        <PageAction
          label={REGISTER_IMPORT_COPY.DOWNLOAD_REGISTER}
          disabled={download.isPending}
          onClick={() => download.mutate('register')}
        />
        {proposal.asicEvidence !== null && (
          <PageAction
            label={REGISTER_IMPORT_COPY.DOWNLOAD_ASIC}
            disabled={download.isPending}
            onClick={() => download.mutate('asic')}
          />
        )}
      </div>
      {download.isError && (
        <p role="alert" className="text-sm text-error-light">
          {apiErrorSentence(download.error, DOWNLOAD_FAILED, DOWNLOAD_FAILED)}
        </p>
      )}
      {available.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {available.map((kind) => (
            <PageAction
              key={kind}
              label={REGISTER_IMPORT_COPY.DECISIONS[kind]}
              disabled={busy}
              onClick={() => begin(kind)}
            />
          ))}
        </div>
      )}
      <Modal
        isOpen={!!active}
        onClose={close}
        title={active ? `${REGISTER_IMPORT_COPY.DECISIONS[active]} import` : ''}
        showFooter
        confirmLabel={active ? `${REGISTER_IMPORT_COPY.DECISIONS[active]} import` : 'Confirm'}
        confirmLoading={!!decision?.busy}
        confirmDisabled={!ready}
        onConfirm={() => {
          if (ready && decision) void decision.confirm();
        }}
        size="lg"
      >
        {active && decision && (
          <DecisionPanel
            kind={active}
            decision={decision}
            current={current}
            reason={reason}
            onReason={setReason}
            onPreview={() => void reject.open('reject', reason.trim())}
          />
        )}
      </Modal>
    </li>
  );
}

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  REGISTER_CORRECTION_COPY,
  REGISTER_CORRECTION_DECISIONS,
  REGISTER_CORRECTION_UNMET_COPY,
  apiErrorSentence,
  downloadRegisterCorrectionFile,
  formatDateTime,
  useRegisterDecision,
  type RegisterCorrection,
  type RegisterCorrectionDecisionPreview,
  type RegisterDecisionKind,
  type RegisterEntry,
} from '@ledova/shared';
import { Row, Rows, Status } from '@components/Ledger';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { DecisionTrail } from './DecisionTrail';
import { RegisterChanges } from './RegisterChanges';
import {
  DOWNLOAD_FAILED,
  STAGE_TONES,
  STEP_CHANGED,
  describeEntry,
  retainedName,
  type RegisterSteps,
} from './proposals';
import { saveFile } from './useCompanyRegister';
import type { ClassCorrection } from './useRegisterCorrections';

type Decision = ReturnType<typeof useRegisterDecision<RegisterCorrection, RegisterCorrectionDecisionPreview>>;

const COPY = REGISTER_CORRECTION_COPY;
const KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];

function DecisionPanel({
  kind,
  decision,
  current,
  reason,
  entry,
  onReason,
  onPreview,
}: {
  kind: RegisterDecisionKind;
  decision: Decision;
  current: boolean;
  reason: string;
  entry: RegisterEntry;
  onReason: (value: string) => void;
  onPreview: () => void;
}) {
  const preview = decision.target?.preview;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-primary">{COPY.CONFIRMATIONS[kind]}</p>
      {kind === 'reject' && (
        <>
          <label className="block space-y-1 text-sm text-text-primary">
            {COPY.REJECTION_REASON}
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
          {kind === 'apply' && <p className="text-sm text-text-muted">{COPY.COMPENSATION_NOTE}</p>}
          {preview.unmetRequirements.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-text-muted">This decision cannot be recorded yet:</p>
              <ul className="flex flex-col gap-1 text-sm text-text-primary">
                {preview.unmetRequirements.map((code) => (
                  <li key={code}>{REGISTER_CORRECTION_UNMET_COPY[code] ?? code}</li>
                ))}
              </ul>
            </div>
          )}
          <Rows>
            <Row label="Register sequence">{preview.registerSequence}</Row>
            <Row label={COPY.EFFECTIVE_ON}>{preview.effectiveOn}</Row>
            <Row label={COPY.ORIGINAL_CHANGES}>
              <RegisterChanges changes={preview.originalChanges} named={entry.changes} />
            </Row>
            <Row label={COPY.COMPENSATING_CHANGES}>
              <RegisterChanges changes={preview.changes} named={entry.changes} />
            </Row>
          </Rows>
        </>
      )}
    </div>
  );
}

export function CorrectionRecord({
  correction: { proposal, entry },
  steps,
  guard,
  onDecided,
  onRefused,
}: {
  correction: ClassCorrection;
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
  const approve = useRegisterDecision(apiClient, REGISTER_CORRECTION_DECISIONS, proposal, options('approve'));
  const apply = useRegisterDecision(apiClient, REGISTER_CORRECTION_DECISIONS, proposal, options('apply'));
  const reject = useRegisterDecision(apiClient, REGISTER_CORRECTION_DECISIONS, proposal, options('reject'));
  const decisions = { approve, apply, reject };
  const decision = active ? decisions[active] : null;
  const busy = approve.busy || apply.busy || reject.busy;
  const download = useMutation({
    mutationFn: async () => {
      guard();
      const { data } = await downloadRegisterCorrectionFile(apiClient, proposal.uuid, {
        ledovaSubmissionGuard: guard,
      });
      guard();
      saveFile(data, retainedName(proposal.evidenceSnapshot, `register-correction-${proposal.uuid}`));
    },
  });
  const context = `correction of entry ${entry.sequence}`;
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
            {COPY.STAGES[proposal.stage] ?? proposal.stage}
          </Status>
        </Row>
        {proposal.preparedByName !== null && <Row label="Prepared by">{proposal.preparedByName || 'Not provided'}</Row>}
        <Row label="Prepared on">{formatDateTime(proposal.createdAt)}</Row>
        <Row label={COPY.EFFECTIVE_ON}>{proposal.effectiveOn}</Row>
        <Row label={COPY.ORIGINAL_CHANGES}>
          <span className="block">{describeEntry(entry)}</span>
          <RegisterChanges changes={entry.changes} />
        </Row>
        <Row label={COPY.COMPENSATING_CHANGES}>
          <RegisterChanges changes={proposal.changes} named={entry.changes} />
        </Row>
        <Row label={COPY.AUTHORITY}>{COPY.AUTHORITIES[proposal.authority] ?? proposal.authority}</Row>
        {proposal.approvingDirector && <Row label={COPY.APPROVING_DIRECTOR}>{proposal.approvingDirector}</Row>}
        <Row label={COPY.AUTHORITY_REFERENCE}>{proposal.authorityReference}</Row>
        <Row label={COPY.REASON}>{proposal.reason}</Row>
        <DecisionTrail proposal={proposal} labels={COPY.DECISIONS} />
      </Rows>
      <p className="text-sm text-text-muted">
        {proposal.providedBy === 'company' ? COPY.PROVIDED_BY_COMPANY : COPY.STAFF_VERIFIED}
      </p>
      <div className="flex flex-wrap gap-2">
        <PageAction
          label={COPY.DOWNLOAD}
          context={context}
          disabled={download.isPending}
          onClick={() => download.mutate()}
        />
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
              label={COPY.DECISIONS[kind]}
              context={context}
              disabled={busy}
              onClick={() => begin(kind)}
            />
          ))}
        </div>
      )}
      <Modal
        isOpen={!!active}
        onClose={close}
        title={active ? `${COPY.DECISIONS[active]} correction` : ''}
        showFooter
        confirmLabel={active ? `${COPY.DECISIONS[active]} correction` : 'Confirm'}
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
            entry={entry}
            onReason={setReason}
            onPreview={() => void reject.open('reject', reason.trim())}
          />
        )}
      </Modal>
    </li>
  );
}

import { useState, type ReactNode } from 'react';
import { useRegisterDecision, type RegisterDecisionFamily, type RegisterDecisionKind } from '@ledova/shared';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import { FIELD_CLASS } from '@components/fieldClass';
import apiClient from '@services/apiClient';
import { STEP_CHANGED, type RegisterSteps } from './proposals';

type Proposal = { uuid: string; providedBy: string; status: string };
type Preview = { previewDigest: string; canDecide: boolean; unmetRequirements: string[] };

export type DecisionCopy = {
  DECISIONS: Record<RegisterDecisionKind, string>;
  CONFIRMATIONS: Record<RegisterDecisionKind, string>;
  REJECTION_REASON: string;
};

const KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];

export function RegisterDecisions<Shown extends Proposal, Previewed extends Preview>({
  family,
  copy,
  noun,
  proposal,
  steps,
  guard,
  context,
  onDecided,
  onRefused,
  note,
  children,
}: {
  family: RegisterDecisionFamily<Shown, Previewed>;
  copy: DecisionCopy;
  noun: string;
  proposal: Shown;
  steps: RegisterSteps;
  guard: () => void;
  context?: string;
  onDecided: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
  note?: (kind: RegisterDecisionKind, preview: Previewed) => ReactNode;
  children: (preview: Previewed) => ReactNode;
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
  const approve = useRegisterDecision(apiClient, family, proposal, options('approve'));
  const apply = useRegisterDecision(apiClient, family, proposal, options('apply'));
  const reject = useRegisterDecision(apiClient, family, proposal, options('reject'));
  const decisions = { approve, apply, reject };
  const decision = active ? decisions[active] : null;
  const busy = approve.busy || apply.busy || reject.busy;
  const kinds: RegisterDecisionKind[] = proposal.providedBy === 'company' ? KINDS : ['reject'];
  const available = proposal.status === 'submitted' ? kinds.filter((kind) => steps[kind]) : [];
  const target = decision?.target;
  const preview = target?.preview;
  const current = !!active && !!target && steps[active]?.uuid === target.request.appointment;
  const ready =
    !!decision &&
    !decision.busy &&
    !!target &&
    current &&
    target.preview.canDecide &&
    (active !== 'reject' || target.request.reason === reason.trim());
  const title = active ? `${copy.DECISIONS[active]} ${noun}` : '';
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
    <>
      {available.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {available.map((kind) => (
            <PageAction
              key={kind}
              label={copy.DECISIONS[kind]}
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
        title={title}
        showFooter
        confirmLabel={active ? title : 'Confirm'}
        confirmLoading={!!decision?.busy}
        confirmDisabled={!ready}
        onConfirm={() => {
          if (ready && decision) void decision.confirm();
        }}
        size="lg"
      >
        {active && decision && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-primary">{copy.CONFIRMATIONS[active]}</p>
            {active === 'reject' && (
              <>
                <label className="block space-y-1 text-sm text-text-primary">
                  {copy.REJECTION_REASON}
                  <textarea
                    className={FIELD_CLASS}
                    rows={3}
                    maxLength={1000}
                    value={reason}
                    disabled={decision.busy}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <PageAction
                  label="Preview the rejection"
                  disabled={decision.busy || !reason.trim() || target?.request.reason === reason.trim()}
                  onClick={() => void reject.open('reject', reason.trim())}
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
                {note?.(active, preview)}
                {preview.unmetRequirements.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <p className="text-sm text-text-muted">This decision cannot be recorded yet:</p>
                    <ul className="flex flex-col gap-1 text-sm text-text-primary">
                      {preview.unmetRequirements.map((code) => (
                        <li key={code}>{family.unmet[code] ?? code}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {children(preview)}
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

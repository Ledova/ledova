import { Field, TextArea } from '@components/Field';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  FIELD_LIMITS,
  useRegisterDecision,
  type RegisterDecisionFamily,
  type RegisterDecisionKind,
  refusalSentences,
} from '@ledova/shared';
import { Modal } from '@components/Modal';
import { FormActions, PageAction } from '@components/Page';
import { STEP_CHANGED, type RegisterSteps } from './proposals';
import { Loading } from '@components/Ledger';
import { ErrorSummary } from '@components/ErrorSummary';
import { useErrorSummary } from '@hooks/useErrorSummary';

type Proposal = { uuid: string; providedBy: string; status: string };
type Preview = { previewDigest: string; canDecide: boolean; unmetRequirements: string[] };

type DecisionCopy = {
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
  newEffectGuard,
  context,
  onDecided,
  onRefused,
  note,
  children,
  visible = true,
  onHeldChange,
  recordActions = false,
  approveLabel,
  pageReview,
  formatError = (message) => message,
}: {
  family: RegisterDecisionFamily<Shown, Previewed>;
  copy: DecisionCopy;
  noun: string;
  proposal: Shown;
  steps: RegisterSteps;
  guard: () => void;
  newEffectGuard?: (kind: RegisterDecisionKind) => void;
  context?: string;
  onDecided: (proposal: Shown) => Promise<unknown>;
  onRefused: () => Promise<unknown>;
  note?: (kind: RegisterDecisionKind, preview: Previewed) => ReactNode;
  children: (preview: Previewed, kind: RegisterDecisionKind) => ReactNode;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
  recordActions?: boolean;
  approveLabel?: string;
  pageReview?: {
    target: HTMLElement | null;
    onChange: (open: boolean) => void;
    title: string;
    labels: Record<RegisterDecisionKind, string>;
  };
  formatError?: (message: string) => string;
}) {
  const [active, setActive] = useState<RegisterDecisionKind | null>(null);
  const [reason, setReason] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const reviewFocused = useRef(false);
  const openers = useRef<Partial<Record<RegisterDecisionKind, HTMLButtonElement | null>>>({});
  const opener = useRef<HTMLElement | null>(null);
  const openerKind = useRef<RegisterDecisionKind | null>(null);
  const record = useRef<HTMLElement | null>(null);
  const [focusRequest, setFocusRequest] = useState({ key: 0, completed: false });
  const focused = useRef(0);
  const pageOpen = useRef(false);
  const onPageChange = useRef(pageReview?.onChange);
  useEffect(() => {
    onPageChange.current = pageReview?.onChange;
    pageOpen.current = !!pageReview && !!active;
  }, [pageReview?.onChange, active]);
  useEffect(
    () => () => {
      if (pageOpen.current) onPageChange.current?.(false);
    },
    [],
  );
  useEffect(() => {
    if (!active) reviewFocused.current = false;
    if (pageReview && active && visible && pageReview.target && !reviewFocused.current) {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView?.({ block: 'start' });
      reviewFocused.current = true;
    }
  }, [active, visible, pageReview?.target]);
  useEffect(() => {
    if (focused.current === focusRequest.key || active || !visible) return;
    const available = (element: HTMLElement | null) =>
      element?.isConnected &&
      !(element instanceof HTMLButtonElement && element.disabled) &&
      !element.closest('[hidden], [aria-hidden="true"]') &&
      getComputedStyle(element).display !== 'none' &&
      getComputedStyle(element).visibility !== 'hidden';
    const currentOpener = focusRequest.completed
      ? null
      : openerKind.current
        ? (openers.current[openerKind.current] ?? opener.current)
        : opener.current;
    const destination = available(currentOpener ?? null)
      ? currentOpener
      : available(record.current)
        ? record.current
        : null;
    if (!destination) return;
    if (destination === record.current) destination.tabIndex = -1;
    destination.focus({ preventScroll: true });
    destination.scrollIntoView?.({ block: 'nearest' });
    focused.current = focusRequest.key;
  });
  const finish = (completed = false) => {
    setActive(null);
    if (pageReview) {
      setFocusRequest((request) => ({ key: request.key + 1, completed }));
      pageReview.onChange(false);
    }
  };
  const checks = useErrorSummary({ reason: !reason.trim() && 'Give the reason for rejection.' });
  const options = (kind: RegisterDecisionKind) => ({
    appointment: steps[kind]?.uuid,
    newKey: () => crypto.randomUUID(),
    guard,
    newEffectGuard: () => newEffectGuard?.(kind),
    requestConfig: () => ({ ledovaSubmissionGuard: guard }),
    onDecided: async (receipt: Shown) => {
      finish(true);
      await onDecided(receipt);
    },
    onRefused,
  });
  const approve = useRegisterDecision(family, proposal, options('approve'));
  const apply = useRegisterDecision(family, proposal, options('apply'));
  const reject = useRegisterDecision(family, proposal, options('reject'));
  const decisions = { approve, apply, reject };
  const decision = active ? decisions[active] : null;
  const busy = approve.busy || apply.busy || reject.busy;
  const held = busy || !!approve.recovery || !!apply.recovery || !!reject.recovery || (!!pageReview && !!active);
  useEffect(() => {
    onHeldChange?.(proposal.uuid, held);
    return () => onHeldChange?.(proposal.uuid, false);
  }, [onHeldChange, proposal.uuid, held]);
  const kinds: RegisterDecisionKind[] = proposal.providedBy === 'company' ? KINDS : ['reject'];
  const available = proposal.status === 'submitted' ? kinds.filter((kind) => steps[kind]) : [];
  const actionKinds = recordActions
    ? [...available.filter((kind) => kind === 'reject'), ...available.filter((kind) => kind !== 'reject')]
    : available;
  const primaryKind = available.includes('apply') ? 'apply' : 'approve';
  const target = decision?.target;
  const preview = target?.preview;
  const current = !!active && !!target && steps[active]?.uuid === target.request.appointment;
  const ready =
    !!decision &&
    !decision.busy &&
    !!target &&
    (current || !!decision.recovery) &&
    target.preview.canDecide &&
    (active !== 'reject' || target.request.reason === reason.trim());
  const title = active ? `${copy.DECISIONS[active]} ${noun}` : '';
  const begin = (kind: RegisterDecisionKind) => {
    if (active || busy) return;
    if (pageReview) {
      openerKind.current = kind;
      opener.current = openers.current[kind] ?? (document.activeElement as HTMLElement | null);
      record.current = opener.current?.closest('li') ?? null;
      pageOpen.current = true;
      pageReview.onChange(true);
    }
    setReason(decisions[kind].recovery?.request.reason ?? '');
    checks.reset();
    setActive(kind);
    void decisions[kind].open(kind);
  };
  const close = () => {
    decision?.cancel();
    finish();
  };
  const confirm = () => {
    if (ready && decision) void (decision.recovery ? decision.recover() : decision.confirm());
  };
  const actionButtons = actionKinds.map((kind) => (
    <PageAction
      key={kind}
      ref={(element) => {
        openers.current[kind] = element;
      }}
      label={kind === 'approve' ? (approveLabel ?? copy.DECISIONS[kind]) : copy.DECISIONS[kind]}
      context={context}
      primary={recordActions && kind === primaryKind}
      disabled={busy}
      onClick={() => begin(kind)}
    />
  ));
  const content = active && decision && (
    <div className={pageReview ? 'flex flex-col gap-5' : 'flex flex-col gap-3'}>
      {!pageReview && <p className="text-sm text-text-primary">{copy.CONFIRMATIONS[active]}</p>}
      {decision.recovery && (
        <>
          <p className="text-sm text-text-muted">
            Recovering the original request and its receipt. No new preview or decision key is created.
          </p>
          <PageAction
            label="Recover original decision receipt"
            disabled={busy}
            onClick={() => void decision.recover()}
          />
        </>
      )}
      {active === 'reject' && (
        <>
          <ErrorSummary {...checks.summary} />
          <Field {...checks.field('reason')} label={copy.REJECTION_REASON}>
            <TextArea
              rows={3}
              maxLength={FIELD_LIMITS.REASON}
              value={reason}
              disabled={decision.busy || !!decision.recovery}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <PageAction
            label="Preview the rejection"
            disabled={decision.busy || !!decision.recovery || target?.request.reason === reason.trim()}
            onClick={() => {
              if (checks.check()) void reject.open('reject', reason.trim());
            }}
          />
        </>
      )}
      {decision.error && (
        <p role="alert" className="text-sm text-error-light">
          {formatError(decision.error)}
        </p>
      )}
      {preview && !current && !decision.recovery && (
        <p role="alert" className="text-sm text-error-light">
          {STEP_CHANGED}
        </p>
      )}
      {decision.busy && !preview && <Loading>Loading the preview…</Loading>}
      {preview && (
        <>
          {note?.(active, preview)}
          {preview.unmetRequirements.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-sm text-text-muted">This decision cannot be recorded yet:</p>
              <ul className="flex flex-col gap-1 text-sm text-text-primary">
                {refusalSentences(preview.unmetRequirements, family.unmet).map((sentence) => (
                  <li key={sentence}>{sentence}</li>
                ))}
              </ul>
            </div>
          )}
          {children(preview, active)}
        </>
      )}
    </div>
  );
  const review = pageReview ? (
    active && pageReview.target ? (
      createPortal(
        <div role="region" aria-label={pageReview.title} className="space-y-5">
          <h2
            ref={heading}
            tabIndex={-1}
            className="font-display text-xl tracking-[-0.01em] text-text-primary focus:outline-none"
          >
            {pageReview.title}
          </h2>
          {content}
          <FormActions>
            <PageAction label="Cancel" disabled={busy} onClick={close} />
            <PageAction
              label={pageReview.labels[active]}
              primary
              busy={!!decision?.busy}
              busyLabel={preview || decision?.recovery ? 'Recording decision…' : 'Loading preview…'}
              disabled={!ready}
              onClick={confirm}
            />
          </FormActions>
        </div>,
        pageReview.target,
      )
    ) : null
  ) : (
    <Modal
      isOpen={!!active}
      onClose={close}
      title={title}
      showFooter
      confirmLabel={active ? title : 'Confirm'}
      busy={!!decision?.busy}
      busyLabel="Recording decision…"
      confirmDisabled={!ready}
      onConfirm={confirm}
      size="lg"
    >
      {content}
    </Modal>
  );
  if (!visible) return null;
  return (
    <>
      {available.length > 0 &&
        (recordActions ? (
          <FormActions>{actionButtons}</FormActions>
        ) : (
          <div className="flex flex-wrap gap-2">{actionButtons}</div>
        ))}
      {KINDS.map(
        (kind) =>
          decisions[kind].recovery && (
            <div key={`recover-${kind}`} className="flex flex-col items-start gap-2">
              <p className="text-sm text-text-muted">
                The original decision receipt is uncertain. Recover it with the same request.
              </p>
              <PageAction
                label={`Recover ${copy.DECISIONS[kind].toLowerCase()} receipt`}
                context={context}
                disabled={busy}
                onClick={() => void decisions[kind].recover()}
              />
              {active !== kind && decisions[kind].error && (
                <p role="alert" className="text-sm text-error-light">
                  {formatError(decisions[kind].error)}
                </p>
              )}
            </div>
          ),
      )}
      {review}
    </>
  );
}

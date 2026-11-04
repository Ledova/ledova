import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import {
  FIELD_LIMITS,
  REGISTER_COPY,
  refusalSentences,
  useErrorSummary,
  useRegisterDecision,
  type RegisterDecisionFamily,
  type RegisterDecisionKind,
  type RegisterSteps,
} from '@ledova/shared';
import { Action, FormActions, Loading, useCardStyles } from '../../components/Ledger';
import { Field } from '../../components/register/RegisterFields';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useLedgerStyles } from './useLedgerStyles';

type Proposal = { uuid: string; providedBy: string; status: string };
type Preview = { previewDigest: string; canDecide: boolean; unmetRequirements: string[] };

type DecisionCopy = { DECISIONS: Record<RegisterDecisionKind, string>; REJECTION_REASON: string };

const KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];

export function RegisterDecisions<Shown extends Proposal, Previewed extends Preview>({
  family,
  copy,
  proposal,
  steps,
  guard,
  newEffectGuard,
  context,
  onDecided,
  onRefused,
  children,
  visible,
  onHeldChange,
  approveLabel,
  review,
  note,
}: {
  family: RegisterDecisionFamily<Shown, Previewed>;
  copy: DecisionCopy;
  proposal: Shown;
  steps: RegisterSteps;
  guard: () => void;
  newEffectGuard?: (kind: RegisterDecisionKind) => void;
  context: string;
  onDecided: (proposal: Shown) => Promise<unknown>;
  onRefused: () => Promise<unknown>;
  children: (preview: Previewed, kind: RegisterDecisionKind) => ReactNode;
  visible: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
  approveLabel: string;
  review: {
    onChange: (open: boolean) => void;
    title: string | Record<RegisterDecisionKind, string>;
    labels: Record<RegisterDecisionKind, string>;
    confirmations?: Record<RegisterDecisionKind, string>;
  };
  note?: (kind: RegisterDecisionKind, preview: Previewed) => ReactNode;
}) {
  const card = useCardStyles();
  const look = useLedgerStyles();
  const styles = useCompanyStyles();
  const [active, setActive] = useState<RegisterDecisionKind | null>(null);
  const [reason, setReason] = useState('');
  const reviewOpen = useRef(false);
  const onReview = useRef(review.onChange);
  useEffect(() => {
    onReview.current = review.onChange;
    reviewOpen.current = !!active;
  }, [review.onChange, active]);
  useEffect(
    () => () => {
      if (reviewOpen.current) onReview.current(false);
    },
    [],
  );
  const finish = () => {
    Keyboard.dismiss();
    setActive(null);
    review.onChange(false);
  };
  const checks = useErrorSummary({ reason: !reason.trim() && 'Give the reason for rejection.' });
  const options = (kind: RegisterDecisionKind) => ({
    appointment: steps[kind]?.uuid,
    newKey: randomUUID,
    guard,
    newEffectGuard: () => newEffectGuard?.(kind),
    requestConfig: () => ({ ...orderSubmissionSession.requestConfig(), ledovaSubmissionGuard: guard }),
    onDecided: async (receipt: Shown) => {
      finish();
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
  const held = busy || !!approve.recovery || !!apply.recovery || !!reject.recovery || !!active;
  useEffect(() => {
    onHeldChange?.(proposal.uuid, held);
    return () => onHeldChange?.(proposal.uuid, false);
  }, [onHeldChange, proposal.uuid, held]);
  const kinds: RegisterDecisionKind[] = proposal.providedBy === 'company' ? KINDS : ['reject'];
  const available = proposal.status === 'submitted' ? kinds.filter((kind) => steps[kind]) : [];
  const primaryKind = available.includes('apply') ? 'apply' : 'approve';
  const actionKinds = [
    ...available.filter((kind) => kind === 'reject'),
    ...available.filter((kind) => kind !== 'reject'),
  ];
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
  const begin = (kind: RegisterDecisionKind) => {
    if (active || busy) return;
    reviewOpen.current = true;
    review.onChange(true);
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
    if (!ready || !decision) return;
    Keyboard.dismiss();
    void (decision.recovery ? decision.recover() : decision.confirm());
  };
  if (!visible) return null;
  if (active && decision) {
    const title = typeof review.title === 'string' ? review.title : review.title[active];
    return (
      <View accessibilityLabel={title} style={look.review}>
        <Text accessibilityRole="header" style={card.title}>
          {title}
        </Text>
        {!!review.confirmations && <Text style={look.text}>{review.confirmations[active]}</Text>}
        {decision.recovery && (
          <>
            <Text style={look.muted}>
              Recovering the original request and its receipt. No new preview or decision key is created.
            </Text>
            <Action label="Recover original decision receipt" disabled={busy} onPress={() => void decision.recover()} />
          </>
        )}
        {active === 'reject' && (
          <>
            <Field
              label={copy.REJECTION_REASON}
              value={reason}
              multiline
              rows={3}
              maxLength={FIELD_LIMITS.REASON}
              editable={!decision.busy && !decision.recovery}
              error={checks.field('reason').error}
              onChange={setReason}
            />
            <Action
              label="Preview the rejection"
              disabled={decision.busy || !!decision.recovery || target?.request.reason === reason.trim()}
              onPress={() => {
                if (!checks.check()) return;
                Keyboard.dismiss();
                void reject.open('reject', reason.trim());
              }}
            />
          </>
        )}
        {!!decision.error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {decision.error}
          </Text>
        )}
        {preview && !current && !decision.recovery && (
          <Text accessibilityRole="alert" style={styles.error}>
            {REGISTER_COPY.STEP_CHANGED}
          </Text>
        )}
        {decision.busy && !preview && <Loading>Loading the preview…</Loading>}
        {preview && (
          <>
            {note?.(active, preview)}
            {preview.unmetRequirements.length > 0 && (
              <View style={look.terms}>
                <Text style={look.muted}>This decision cannot be recorded yet:</Text>
                {refusalSentences(preview.unmetRequirements, family.unmet).map((sentence) => (
                  <Text key={sentence} style={look.text}>
                    {sentence}
                  </Text>
                ))}
              </View>
            )}
            {children(preview, active)}
          </>
        )}
        <FormActions>
          <Action label="Cancel" accessibilityLabel={`Cancel (${title})`} disabled={busy} onPress={close} />
          <Action
            primary
            label={
              decision.busy
                ? preview || decision.recovery
                  ? 'Recording decision…'
                  : 'Loading preview…'
                : review.labels[active]
            }
            disabled={!ready}
            onPress={confirm}
          />
        </FormActions>
      </View>
    );
  }
  return (
    <>
      {available.length > 0 && (
        <FormActions>
          {actionKinds.map((kind) => {
            const label = kind === 'approve' ? approveLabel : copy.DECISIONS[kind];
            return (
              <Action
                key={kind}
                label={label}
                accessibilityLabel={`${label} (${context})`}
                primary={kind === primaryKind}
                disabled={busy}
                onPress={() => begin(kind)}
              />
            );
          })}
        </FormActions>
      )}
      {KINDS.map((kind) => {
        const recovery = decisions[kind].recovery;
        if (!recovery) return null;
        const label = `Recover ${copy.DECISIONS[kind].toLowerCase()} receipt`;
        return (
          <View key={`recover-${kind}`} style={look.list}>
            <Text style={look.muted}>
              The original decision receipt is uncertain. Recover it with the same request.
            </Text>
            <Action
              label={label}
              accessibilityLabel={`${label} (${context})`}
              disabled={busy}
              onPress={() => void decisions[kind].recover()}
            />
            {active !== kind && !!decisions[kind].error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {decisions[kind].error}
              </Text>
            )}
          </View>
        );
      })}
    </>
  );
}

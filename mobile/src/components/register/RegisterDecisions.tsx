import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  FIELD_LIMITS,
  refusalSentences,
  useRegisterDecision,
  useSubmissionOwner,
  type OwnCompanyAppointment,
  type RegisterDecisionFamily,
  type RegisterDecisionKind,
  type RegisterStep,
} from '@ledova/shared';
import { Action } from '../Ledger';
import { assertSessionEpoch } from '../../services/sessionScope';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { DecisionCopy } from './RegisterDecision';

type Proposal = { uuid: string; providedBy: string; status: string };
type Preview = { previewDigest: string; canDecide: boolean; unmetRequirements: string[] };

const KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];

export function RegisterDecisions<Shown extends Proposal, Previewed extends Preview>({
  family,
  copy,
  proposal,
  steps,
  epoch,
  readGuard,
  newEffectGuard,
  description,
  onDecided,
  onRefused,
  children,
  visible = true,
  onHeldChange,
  approveLabel,
  review,
}: {
  family: RegisterDecisionFamily<Shown, Previewed>;
  copy: DecisionCopy;
  proposal: Shown;
  steps: Partial<Record<RegisterStep, OwnCompanyAppointment | undefined>>;
  epoch: number;
  readGuard: () => void;
  newEffectGuard?: (kind: RegisterDecisionKind) => void;
  description: string;
  onDecided: (proposal: Shown) => Promise<unknown>;
  onRefused: () => Promise<unknown>;
  children: (preview: Previewed, kind: RegisterDecisionKind) => ReactNode;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
  approveLabel?: string;
  review: { onChange: (open: boolean) => void; labels: Record<RegisterDecisionKind, string> };
}) {
  const styles = useCompanyStyles();
  const [active, setActive] = useState<RegisterDecisionKind | null>(null);
  const [reason, setReason] = useState('');
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const mounted = useRef(true);
  const scope = useRef(proposal.uuid);
  const onChange = useRef(review.onChange);
  const open = useRef(false);
  useLayoutEffect(() => {
    scope.current = proposal.uuid;
    onChange.current = review.onChange;
    open.current = !!active;
  }, [proposal.uuid, review.onChange, active]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (open.current) onChange.current(false);
    };
  }, []);
  const guard = () => {
    assertSessionEpoch(epoch);
    if (!mounted.current || !owner || boundary.get() !== owner || scope.current !== proposal.uuid)
      throw new Error('The account or instruction changed. Reopen it before continuing.');
    readGuard();
  };
  const finish = () => {
    setActive(null);
    review.onChange(false);
  };
  const shared = {
    newKey: () => Crypto.randomUUID(),
    guard,
    requestConfig: () => ({ ledovaSessionEpoch: epoch, ledovaSubmissionGuard: guard }),
    onDecided: async (receipt: Shown) => {
      finish();
      await onDecided(receipt);
    },
    onRefused,
  };
  const approve = useRegisterDecision(family, proposal, {
    ...shared,
    appointment: steps.approve?.uuid,
    newEffectGuard: () => newEffectGuard?.('approve'),
  });
  const apply = useRegisterDecision(family, proposal, {
    ...shared,
    appointment: steps.apply?.uuid,
    newEffectGuard: () => newEffectGuard?.('apply'),
  });
  const reject = useRegisterDecision(family, proposal, {
    ...shared,
    appointment: steps.reject?.uuid,
    newEffectGuard: () => newEffectGuard?.('reject'),
  });
  const decisions = { approve, apply, reject };
  const decision = active ? decisions[active] : null;
  const busy = approve.busy || apply.busy || reject.busy;
  const held = busy || !!approve.recovery || !!apply.recovery || !!reject.recovery || !!active;
  useEffect(() => {
    onHeldChange?.(proposal.uuid, held);
  }, [onHeldChange, proposal.uuid, held]);
  useEffect(() => () => onHeldChange?.(proposal.uuid, false), [onHeldChange, proposal.uuid]);
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
    review.onChange(true);
    setReason(decisions[kind].recovery?.request.reason ?? '');
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
  const label = (kind: RegisterDecisionKind) =>
    kind === 'approve' ? (approveLabel ?? copy.DECISIONS[kind]) : copy.DECISIONS[kind];
  if (!visible) return null;
  if (active && decision)
    return (
      <View style={styles.group}>
        {decision.recovery && (
          <>
            <Text style={styles.muted}>
              Recovering the original request and its receipt. No new preview or decision key is created.
            </Text>
            <Action label="Recover original decision receipt" disabled={busy} onPress={() => void decision.recover()} />
          </>
        )}
        {active === 'reject' && (
          <>
            <Text style={styles.text}>{copy.REJECTION_REASON}</Text>
            <TextInput
              accessibilityLabel={copy.REJECTION_REASON}
              style={styles.input}
              value={reason}
              editable={!decision.busy && !decision.recovery}
              maxLength={FIELD_LIMITS.REASON}
              multiline
              onChangeText={setReason}
            />
            <Action
              label="Preview the rejection"
              disabled={
                decision.busy || !!decision.recovery || !reason.trim() || target?.request.reason === reason.trim()
              }
              onPress={() => void reject.open('reject', reason.trim())}
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
            Your appointment for this step changed. Cancel and start this decision again.
          </Text>
        )}
        {decision.busy && !preview && <Text style={styles.muted}>Loading the preview…</Text>}
        {preview && (
          <>
            {preview.unmetRequirements.length > 0 && (
              <View style={styles.group}>
                <Text style={styles.muted}>This decision cannot be recorded yet:</Text>
                {refusalSentences(preview.unmetRequirements, family.unmet).map((sentence) => (
                  <Text key={sentence} style={styles.text}>
                    {sentence}
                  </Text>
                ))}
              </View>
            )}
            {children(preview, active)}
          </>
        )}
        <View style={styles.actions}>
          <Action label="Cancel" disabled={busy} onPress={close} />
          <Action
            label={
              decision.busy
                ? preview || decision.recovery
                  ? 'Recording decision…'
                  : 'Loading preview…'
                : review.labels[active]
            }
            primary
            disabled={!ready}
            onPress={confirm}
          />
        </View>
      </View>
    );
  return (
    <>
      {actionKinds.length > 0 && (
        <View style={styles.actions}>
          {actionKinds.map((kind) => (
            <Action
              key={kind}
              label={label(kind)}
              accessibilityLabel={`${label(kind)} for ${description}`}
              primary={kind === primaryKind}
              disabled={busy}
              onPress={() => begin(kind)}
            />
          ))}
        </View>
      )}
      {KINDS.map(
        (kind) =>
          decisions[kind].recovery && (
            <View key={`recover-${kind}`} style={styles.group}>
              <Text style={styles.muted}>
                The original decision receipt is uncertain. Recover it with the same request.
              </Text>
              <Action
                label={`Recover ${copy.DECISIONS[kind].toLowerCase()} receipt`}
                accessibilityLabel={`Recover ${copy.DECISIONS[kind].toLowerCase()} receipt for ${description}`}
                disabled={busy}
                onPress={() => void decisions[kind].recover()}
              />
              {!!decisions[kind].error && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {decisions[kind].error}
                </Text>
              )}
            </View>
          ),
      )}
    </>
  );
}

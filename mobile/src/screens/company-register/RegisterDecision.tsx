import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  useRegisterDecision,
  useSubmissionOwner,
  type RegisterDecisionFamily,
  type RegisterDecisionKind,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch } from '../../services/sessionScope';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useCompanyStyles } from './styles';

type Preview = { previewDigest: string; canDecide: boolean; unmetRequirements: string[] };

export type DecisionCopy = {
  DECISIONS: Record<RegisterDecisionKind, string>;
  CONFIRMATIONS: Record<RegisterDecisionKind, string>;
  REJECTION_REASON: string;
};

export function RegisterDecision<Proposal extends { uuid: string }, Shown extends Preview>({
  family,
  copy,
  noun,
  proposal,
  kind,
  appointment,
  enabled = true,
  newEffectGuard,
  epoch,
  description,
  onSettled,
  onRefused,
  children,
}: {
  family: RegisterDecisionFamily<Proposal, Shown>;
  copy: DecisionCopy;
  noun: string;
  proposal: Proposal;
  kind: RegisterDecisionKind;
  appointment?: string;
  enabled?: boolean;
  newEffectGuard?: () => void;
  epoch: number;
  description: string;
  onSettled: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
  children: (preview: Shown) => ReactNode;
}) {
  const styles = useCompanyStyles();
  const [visible, setVisible] = useState(false);
  const [reason, setReason] = useState('');
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const mounted = useRef(true);
  const scope = useRef(proposal.uuid);
  useLayoutEffect(() => {
    scope.current = proposal.uuid;
  }, [proposal.uuid]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const guard = () => {
    assertSessionEpoch(epoch);
    if (!mounted.current || !owner || boundary.get() !== owner || scope.current !== proposal.uuid)
      throw new Error('The account or instruction changed. Reopen it before continuing.');
  };
  const decision = useRegisterDecision(apiClient, family, proposal, {
    appointment,
    newKey: () => Crypto.randomUUID(),
    guard,
    newEffectGuard,
    requestConfig: () => ({ ledovaSessionEpoch: epoch, ledovaSubmissionGuard: guard }),
    onDecided: () => {
      setVisible(false);
      return onSettled();
    },
    onRefused,
  });
  const { busy, error, target } = decision;
  const label = copy.DECISIONS[kind];
  const preview = target?.preview;
  const previewed = kind !== 'reject' || target?.request.reason === reason.trim();
  const current = !!target && target.request.appointment === appointment;
  const ready = enabled && !!preview?.canDecide && !busy && previewed && current;
  return (
    <>
      {enabled && appointment && !decision.recovery && (
        <Action
          label={label}
          accessibilityLabel={`${label} the ${description}`}
          disabled={busy}
          onPress={() => {
            setReason('');
            setVisible(true);
            void decision.open(kind);
          }}
        />
      )}
      {decision.recovery && (
        <View style={styles.group}>
          <Text style={styles.muted}>
            The original decision response is unresolved. Recover its retained receipt before starting another decision.
          </Text>
          {error && !visible && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Action
            label={`Recover ${label.toLowerCase()} receipt`}
            accessibilityLabel={`Recover ${label.toLowerCase()} receipt for ${description}`}
            disabled={busy}
            onPress={() => void decision.recover()}
          />
        </View>
      )}
      {visible && (
        <CustomModal
          visible
          title={`${label} ${noun}`}
          busy={busy}
          onClose={() => {
            decision.cancel();
            setVisible(false);
          }}
          actions={
            <Action
              label={busy && preview ? 'Recording…' : 'Confirm'}
              primary
              disabled={!ready}
              onPress={() => {
                if (ready) void decision.confirm();
              }}
            />
          }
        >
          <View style={styles.group}>
            {kind === 'reject' && (
              <>
                <Text style={styles.text}>{copy.REJECTION_REASON}</Text>
                <TextInput
                  accessibilityLabel={copy.REJECTION_REASON}
                  style={styles.input}
                  value={reason}
                  editable={!busy && !decision.recovery}
                  maxLength={1000}
                  multiline
                  onChangeText={setReason}
                />
                <Action
                  label="Preview rejection"
                  disabled={busy || !!decision.recovery || !reason.trim() || target?.request.reason === reason.trim()}
                  onPress={() => void decision.open('reject', reason.trim())}
                />
              </>
            )}
            {kind !== 'reject' && error && !decision.recovery && (
              <Action label="Preview again" disabled={busy} onPress={() => void decision.open(kind)} />
            )}
            {busy && !preview && <Text style={styles.muted}>Previewing the decision…</Text>}
            {error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            )}
            {preview && !current && (
              <Text accessibilityRole="alert" style={styles.error}>
                Your appointment for this step changed. Cancel and start this decision again.
              </Text>
            )}
            {preview && (
              <View style={styles.group}>
                {children(preview)}
                {preview.unmetRequirements.map((code) => (
                  <Text key={code} accessibilityRole="alert" style={styles.error}>
                    {family.unmet[code] ?? code}
                  </Text>
                ))}
                <Text style={styles.heading}>{copy.CONFIRMATIONS[kind]}</Text>
              </View>
            )}
          </View>
        </CustomModal>
      )}
    </>
  );
}

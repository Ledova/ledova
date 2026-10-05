import { useState, type ReactNode } from 'react';
import { Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { useRegisterDecision, type RegisterDecisionFamily, type RegisterDecisionKind } from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch } from '../../services/sessionScope';
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
  appointment: string;
  epoch: number;
  description: string;
  onSettled: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
  children: (preview: Shown) => ReactNode;
}) {
  const styles = useCompanyStyles();
  const [visible, setVisible] = useState(false);
  const [reason, setReason] = useState('');
  const decision = useRegisterDecision(apiClient, family, proposal, {
    appointment,
    newKey: () => Crypto.randomUUID(),
    guard: () => assertSessionEpoch(epoch),
    requestConfig: () => ({ ledovaSessionEpoch: epoch }),
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
  const ready = !!preview?.canDecide && !busy && previewed && current;
  return (
    <>
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
                  editable={!busy}
                  maxLength={1000}
                  multiline
                  onChangeText={setReason}
                />
                <Action
                  label="Preview rejection"
                  disabled={busy || !reason.trim() || target?.request.reason === reason.trim()}
                  onPress={() => void decision.open('reject', reason.trim())}
                />
              </>
            )}
            {kind !== 'reject' && error && (
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

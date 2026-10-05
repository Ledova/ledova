import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  formatShareCount,
  REGISTER_IMPORT_COPY,
  REGISTER_IMPORT_UNMET_COPY,
  useRegisterImportDecision,
  type RegisterImport,
  type RegisterImportDecisionKind,
  type RegisterImportDecisionPreview,
} from '@ledova/shared';
import { Action, Row, Rows } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch } from '../../services/sessionScope';
import { useCompanyStyles } from './styles';

const shares = (value: string | null) => (value === null ? 'None' : formatShareCount(value));

function DecisionPreview({
  kind,
  preview,
}: {
  kind: RegisterImportDecisionKind;
  preview: RegisterImportDecisionPreview;
}) {
  const styles = useCompanyStyles();
  return (
    <View style={styles.group}>
      {kind === 'apply' && preview.opensRegister && (
        <Text style={styles.text}>{REGISTER_IMPORT_COPY.NOT_ON_CHAIN_NOTE}</Text>
      )}
      {preview.statedTotal !== null && preview.statedMemberCount !== null && (
        <Text style={styles.text}>
          {REGISTER_IMPORT_COPY.STATED_FIGURES(formatShareCount(preview.statedTotal), preview.statedMemberCount)}
        </Text>
      )}
      <Text style={styles.text}>
        {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(preview.importedTotal), preview.importedMemberCount)}
      </Text>
      {preview.comparison.map((row) => (
        <View key={row.member} style={styles.group}>
          <Text style={styles.heading}>{row.name ?? row.liveName ?? 'Not in this import'}</Text>
          <Text selectable style={styles.muted}>
            Member {row.member}
          </Text>
          <Rows>
            <Row label="Imported shares">{shares(row.imported)}</Row>
            <Row label="Stored shares">{shares(row.stored)}</Row>
            <Row label="Imported date entered">{row.importedEnteredOn ?? 'None'}</Row>
            <Row label="Stored date entered">{row.enteredOn ?? 'None'}</Row>
            <Row label="Verified identity">
              {row.liveName ? [row.liveName, row.liveAddress].filter(Boolean).join(', ') : 'None'}
            </Row>
          </Rows>
          {row.wallets.map((wallet) => (
            <Text selectable key={wallet} style={styles.muted}>
              {wallet}
            </Text>
          ))}
        </View>
      ))}
      {preview.unmetRequirements.map((code) => (
        <Text key={code} accessibilityRole="alert" style={styles.error}>
          {REGISTER_IMPORT_UNMET_COPY[code] ?? code}
        </Text>
      ))}
      <Text style={styles.heading}>{REGISTER_IMPORT_COPY.CONFIRMATIONS[kind]}</Text>
    </View>
  );
}

export function ImportDecision({
  proposal,
  kind,
  appointment,
  epoch,
  onSettled,
}: {
  proposal: RegisterImport;
  kind: RegisterImportDecisionKind;
  appointment: string;
  epoch: number;
  onSettled: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const [visible, setVisible] = useState(false);
  const [reason, setReason] = useState('');
  const decision = useRegisterImportDecision(apiClient, proposal, {
    appointment,
    newKey: () => Crypto.randomUUID(),
    guard: () => assertSessionEpoch(epoch),
    requestConfig: () => ({ ledovaSessionEpoch: epoch }),
    onDecided: () => {
      setVisible(false);
      return onSettled();
    },
    onRefused: onSettled,
  });
  const label = REGISTER_IMPORT_COPY.DECISIONS[kind];
  const preview = decision.target?.preview;
  const previewAgain = () => void decision.open(kind, kind === 'reject' ? reason.trim() : '');
  return (
    <>
      <Action
        label={label}
        accessibilityLabel={`${label} import ${proposal.uuid}`}
        disabled={decision.busy}
        onPress={() => {
          setReason('');
          setVisible(true);
          if (kind !== 'reject') void decision.open(kind);
        }}
      />
      {visible && (
        <CustomModal
          visible
          title={`${label} import`}
          busy={decision.busy}
          onClose={() => {
            decision.cancel();
            setVisible(false);
          }}
          actions={
            <Action
              label={decision.busy && preview ? 'Recording…' : 'Confirm'}
              primary
              disabled={!preview?.canDecide || decision.busy}
              onPress={() => void decision.confirm()}
            />
          }
        >
          <View style={styles.group}>
            {kind === 'reject' && (
              <>
                <Text style={styles.text}>{REGISTER_IMPORT_COPY.REJECTION_REASON}</Text>
                <TextInput
                  accessibilityLabel={REGISTER_IMPORT_COPY.REJECTION_REASON}
                  style={styles.input}
                  value={reason}
                  editable={!decision.busy}
                  multiline
                  onChangeText={(value) => {
                    setReason(value);
                    decision.cancel();
                  }}
                />
              </>
            )}
            {(kind === 'reject' || decision.error) && (
              <Action
                label={kind === 'reject' ? 'Preview rejection' : 'Preview again'}
                disabled={decision.busy || (kind === 'reject' && !reason.trim())}
                onPress={previewAgain}
              />
            )}
            {decision.busy && !preview && <Text style={styles.muted}>Previewing the decision…</Text>}
            {decision.error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {decision.error}
              </Text>
            )}
            {preview && <DecisionPreview kind={kind} preview={preview} />}
          </View>
        </CustomModal>
      )}
    </>
  );
}

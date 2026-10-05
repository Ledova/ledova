import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  formatShareCount,
  REGISTER_COPY,
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
      <Text style={styles.heading}>Members compared with the stored register</Text>
      {preview.comparison.map((row, index) => (
        <View key={row.member} style={[styles.entry, index === preview.comparison.length - 1 && styles.lastEntry]}>
          <Rows>
            <Row label="Imported name">{row.name ?? 'Not in the import'}</Row>
            <Row label="Imported shares">
              {row.imported === null ? 'Not in the import' : formatShareCount(row.imported)}
            </Row>
            <Row label="Stored shares">{row.stored === null ? 'Not stored' : formatShareCount(row.stored)}</Row>
            <Row label="Imported date entered">{row.importedEnteredOn ?? 'Not in the import'}</Row>
            <Row label="Stored date entered">{row.enteredOn ?? 'Not stored'}</Row>
            <Row label="Live name">{row.liveName || 'No live identity'}</Row>
            {!!row.liveAddress && <Row label="Live address">{row.liveAddress}</Row>}
            <Row label="Wallets">{row.wallets.length > 0 ? row.wallets.join(', ') : REGISTER_COPY.NO_WALLET}</Row>
          </Rows>
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
  description,
  onSettled,
  onRefused,
}: {
  proposal: RegisterImport;
  kind: RegisterImportDecisionKind;
  appointment: string;
  epoch: number;
  description: string;
  onSettled: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
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
    onRefused,
  });
  const { busy, error, target } = decision;
  const label = REGISTER_IMPORT_COPY.DECISIONS[kind];
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
          title={`${label} import`}
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
                <Text style={styles.text}>{REGISTER_IMPORT_COPY.REJECTION_REASON}</Text>
                <TextInput
                  accessibilityLabel={REGISTER_IMPORT_COPY.REJECTION_REASON}
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
                Your appointment for this step changed or could not be checked. Cancel and start this decision again.
              </Text>
            )}
            {preview && <DecisionPreview kind={kind} preview={preview} />}
          </View>
        </CustomModal>
      )}
    </>
  );
}

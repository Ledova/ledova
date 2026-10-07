import { useState } from 'react';
import * as Crypto from 'expo-crypto';
import { Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import {
  formatDateTime,
  useWalletNomination,
  COMPANY_WALLET_UNMET_COPY,
  type WalletNominationPreview,
} from '@ledova/shared';
import { Action, Choice, Row, Rows, Section } from '../../components/Ledger';
import type { BottomTabParamList } from '../../navigation/BottomTabNavigator';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useCompanyStyles } from '../company-register/styles';

function NominationFacts({ preview }: { preview: WalletNominationPreview }) {
  return (
    <Rows>
      <Row label="Company">{preview.company}</Row>
      <Row label="Eligibility request">{preview.request}</Row>
      <Row label="Accepted GENERAL decision">{preview.decision ?? 'Not ready'}</Row>
      <Row label="Selected address">{preview.address}</Row>
      <Row label="Chain">{preview.chain}</Row>
      <Row label="Possession proof completed">{formatDateTime(preview.proofCompletedAt)}</Row>
      <Row label="Company eligibility expiry">{formatDateTime(preview.eligibilityExpiresAt)}</Row>
      <Row label="Preview fingerprint">{preview.previewDigest}</Row>
    </Rows>
  );
}

export function WalletNomination({ requestUuid, guardRequest }: { requestUuid: string; guardRequest: () => void }) {
  const data = useWalletNomination(apiClient, {
    requestUuid,
    guardRequest,
    newKey: Crypto.randomUUID,
    session: orderSubmissionSession,
  });
  const navigation = useNavigation<NavigationProp<BottomTabParamList>>();
  const styles = useCompanyStyles();
  const [consent, setConsent] = useState<{ preview: WalletNominationPreview | null; accepted: boolean }>({
    preview: null,
    accepted: false,
  });
  const preview = data.preview;
  const sharingAccepted = consent.preview === preview && consent.accepted;
  const wallets = data.wallets.isSuccess ? data.wallets.data : [];
  const wallet = wallets?.find((item) => item.uuid === data.walletUuid);
  const blocked = data.busy || data.request.isFetching || data.wallets.isFetching;
  const refreshProof = () => {
    if (!wallet || !data.request.data) return;
    try {
      data.guardWallet();
      navigation.getParent()?.navigate('Wallets', {
        initial: false,
        screen: 'WalletVerification',
        params: { wallet, nomination: { request: requestUuid, company: data.request.data.company } },
      });
    } catch {}
  };
  if (!data.owner) return null;
  return (
    <Section title="Nominate one own Base wallet">
      <Text style={styles.muted}>
        Select one wallet for this company and review its current GENERAL eligibility and possession proof. Sharing this
        address requires a separate confirmation; earlier evidence consent does not share your wallets.
      </Text>
      <Action label="Refresh wallet nomination" disabled={data.busy} onPress={() => void data.refresh()} />
      {data.original && (
        <View style={styles.group}>
          <Text style={styles.muted}>
            This original nomination is unconfirmed. Recover its retained receipt with the same body and key.
          </Text>
          <NominationFacts preview={data.original.preview} />
          <Rows>
            <Row label="Original nomination key">{data.original.body.operationId}</Row>
          </Rows>
          <Action label="Recover original nomination" disabled={data.busy} onPress={() => void data.recover()} />
        </View>
      )}
      {data.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {data.error}
        </Text>
      )}
      {!data.original && (
        <>
          {wallets?.map((item) => (
            <Choice
              key={item.uuid}
              label={`${item.name || 'Own Base wallet'} · ${item.address}`}
              accessibilityLabel={`Select nomination wallet ${item.uuid}`}
              accessibilityRole="radio"
              selected={data.walletUuid === item.uuid}
              disabled={blocked}
              onPress={() => data.setWallet(item.uuid)}
            />
          ))}
          {data.wallets.isSuccess && !wallets?.length && (
            <Text style={styles.muted}>No own Base wallets are available.</Text>
          )}
          {wallet && (
            <Action label="Refresh selected wallet possession proof" disabled={blocked} onPress={refreshProof} />
          )}
          <Action
            label="Review wallet nomination"
            primary
            disabled={blocked || !wallet}
            onPress={() => void data.review()}
          />
          {preview && (
            <View style={styles.group}>
              <NominationFacts preview={preview} />
              {preview.unmetRequirements.map((code) => (
                <Text key={code} style={styles.muted}>
                  {COMPANY_WALLET_UNMET_COPY[code] ?? code}
                </Text>
              ))}
              <Choice
                label="Share this selected address with this exact company"
                accessibilityRole="checkbox"
                selected={sharingAccepted}
                disabled={blocked}
                onPress={() => setConsent({ preview, accepted: !sharingAccepted })}
              />
              <Action
                label="Submit wallet nomination"
                primary
                disabled={blocked || !preview.canSubmit || !sharingAccepted}
                onPress={() => {
                  if (!blocked && preview.canSubmit && sharingAccepted) void data.confirm();
                }}
              />
            </View>
          )}
        </>
      )}
      {(data.request.isError || data.wallets.isError || data.nominations.isError) && (
        <Text accessibilityRole="alert" style={styles.error}>
          Current nomination sources could not be read. Refresh before starting new work; original receipts remain
          available.
        </Text>
      )}
      {data.receipt && !data.nominations.data?.some((row) => row.uuid === data.receipt!.uuid) && (
        <Rows>
          <Row label="Retained nomination receipt">{data.receipt.uuid}</Row>
          <Row label="Company">{data.receipt.company}</Row>
          <Row label="Shared address">{data.receipt.address}</Row>
          <Row label="Submitted">{formatDateTime(data.receipt.submittedAt)}</Row>
        </Rows>
      )}
      <Text style={styles.heading}>Your nominations for this request</Text>
      {data.nominations.data?.map((record) => (
        <Rows key={record.uuid}>
          <Row label="Nomination">{record.uuid}</Row>
          <Row label="Company">{record.company}</Row>
          <Row label="Shared address">{record.address}</Row>
          <Row label="Chain">{record.chain}</Row>
          <Row label="Submitted">{formatDateTime(record.submittedAt)}</Row>
          <Row label="Retained proof completion">{formatDateTime(record.proofCompletedAt)}</Row>
          <Row label="Retained eligibility expiry">{formatDateTime(record.eligibilityExpiresAt)}</Row>
          {record.unmetRequirements.map((code) => (
            <Row key={code} label="Current readiness">
              {COMPANY_WALLET_UNMET_COPY[code] ?? code}
            </Row>
          ))}
        </Rows>
      ))}
    </Section>
  );
}

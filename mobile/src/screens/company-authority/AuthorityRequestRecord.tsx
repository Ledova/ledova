import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import {
  apiErrorSentence,
  COMPANY_AUTHORITY_CAPABILITIES,
  downloadCompanyAuthorityFile,
  formatDateTime,
  type CompanyAuthorityRequest,
  type CompanyCapability,
} from '@ledova/shared';
import { Action, Disclosure, Row, Rows } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { EXTENSION_BY_MIME_TYPE, shareDocumentCopy, UTI_BY_MIME_TYPE } from '../../services/documentCopies';
import { getSessionEpoch } from '../../services/sessionScope';
import { useCompanyStyles } from '../company-register/styles';

function scopeLabels(values: CompanyCapability[]) {
  return values
    .map((value) => COMPANY_AUTHORITY_CAPABILITIES.find((item) => item.value === value)?.label ?? value)
    .join(', ');
}

export function AuthorityRequestRecord({
  request,
  blocked,
  onWithdraw,
}: {
  request: CompanyAuthorityRequest;
  blocked: boolean;
  onWithdraw: () => Promise<void>;
}) {
  const styles = useCompanyStyles();
  const [expanded, setExpanded] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const mounted = useRef(true);
  const ready = useRef(!blocked);
  const pending = useRef(false);
  const withdrawalPending = useRef(false);
  const recordedAt = request.status === 'withdrawn' ? request.withdrawnAt : request.createdAt;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    ready.current = !blocked;
  }, [blocked]);
  const open = async () => {
    if (blocked || pending.current) return;
    const epoch = getSessionEpoch();
    const current = () => mounted.current && ready.current && epoch === getSessionEpoch();
    pending.current = true;
    setOpening(true);
    setError(null);
    try {
      const available = await Sharing.isAvailableAsync();
      if (!current()) return;
      if (!available) throw new Error('Sharing is not available on this device.');
      await shareDocumentCopy(
        epoch,
        async () => {
          if (!current()) throw new Error('The request view changed.');
          const response = await downloadCompanyAuthorityFile(apiClient, request.uuid, { ledovaSessionEpoch: epoch });
          if (!current()) throw new Error('The request view changed.');
          const type = String(response.headers['content-type'] || 'application/octet-stream').split(';')[0];
          return {
            name: `${request.uuid}${EXTENSION_BY_MIME_TYPE[type] || ''}`,
            type,
            bytes: new Uint8Array(response.data),
          };
        },
        async (uri, type) => {
          if (current()) await Sharing.shareAsync(uri, { mimeType: type, UTI: UTI_BY_MIME_TYPE[type] });
        },
      );
    } catch (cause) {
      if (current()) setError(apiErrorSentence(cause, 'The retained evidence could not be opened.'));
    } finally {
      pending.current = false;
      if (mounted.current && epoch === getSessionEpoch()) setOpening(false);
    }
  };
  const withdraw = async () => {
    if (blocked || request.status !== 'pending' || withdrawalPending.current) return;
    const epoch = getSessionEpoch();
    const current = () => mounted.current && epoch === getSessionEpoch();
    withdrawalPending.current = true;
    setWithdrawing(true);
    setWithdrawError(null);
    try {
      await onWithdraw();
    } catch (cause) {
      if (current())
        setWithdrawError(
          apiErrorSentence(cause, 'The withdrawal could not be confirmed. Retry the same request or refresh.'),
        );
    } finally {
      withdrawalPending.current = false;
      if (current()) setWithdrawing(false);
    }
  };
  return (
    <Disclosure
      accessibilityLabel={`Request ${request.originalFilename}`}
      summary={
        <View style={styles.group}>
          <Text style={styles.heading}>{request.companyIdentityRaw.name}</Text>
          <Text style={styles.text}>{request.originalFilename}</Text>
          <Text style={styles.muted}>
            {request.status === 'withdrawn' ? 'Withdrawn' : 'Pending'}
            {recordedAt && ` · ${formatDateTime(recordedAt)}`}
          </Text>
        </View>
      }
      open={expanded}
      onToggle={() => setExpanded(!expanded)}
    >
      <View style={styles.group}>
        <Text style={styles.muted}>{request.verificationMessage}</Text>
        <Rows>
          <Row label="Company">{request.companyIdentityRaw.name}</Row>
          <Row label="ACN">{request.companyIdentityRaw.acn}</Row>
          <Row label="Submitted at">{formatDateTime(request.createdAt)}</Row>
          {request.withdrawnAt && <Row label="Withdrawn at">{formatDateTime(request.withdrawnAt)}</Row>}
          <Row label="Requested permissions">{scopeLabels(request.requestedCapabilities) || 'None'}</Row>
          <Row label="Requested delegation">{scopeLabels(request.delegatableCapabilities) || 'None'}</Row>
          <Row label="Requested expiry">
            {request.requestedExpiresAt ? formatDateTime(request.requestedExpiresAt) : 'None'}
          </Row>
          <Row label="Request" mono>
            {request.uuid}
          </Row>
          <Row label="Evidence fingerprint" mono>
            {request.fileSha256}
          </Row>
        </Rows>
        <Action label="View retained evidence" disabled={blocked || opening} onPress={() => void open()} />
        {request.status === 'pending' && (
          <View style={styles.group}>
            <Text style={styles.muted}>
              Withdrawal cancels this proposal. Its history and evidence remain retained.
            </Text>
            <Action
              label={withdrawing ? 'Withdrawing…' : 'Withdraw request'}
              disabled={blocked || withdrawing}
              onPress={() => void withdraw()}
            />
          </View>
        )}
        {request.status === 'pending' && withdrawError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {withdrawError}
          </Text>
        )}
        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </View>
    </Disclosure>
  );
}

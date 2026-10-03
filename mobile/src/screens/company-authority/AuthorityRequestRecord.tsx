import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import {
  apiErrorSentence,
  COMPANY_AUTHORITY_CAPABILITIES,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  downloadCompanyAuthorityFile,
  formatDateTime,
  type CompanyAuthorityRequest,
  type CompanyCapability,
} from '@ledova/shared';
import { Action, Choice, Disclosure, Row, Rows } from '../../components/Ledger';
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
  onAdmit,
  onRevoke,
}: {
  request: CompanyAuthorityRequest;
  blocked: boolean;
  onWithdraw: () => Promise<void>;
  onAdmit: () => Promise<void>;
  onRevoke: () => Promise<void>;
}) {
  const styles = useCompanyStyles();
  const [expanded, setExpanded] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [changing, setChanging] = useState<'withdraw' | 'admit' | 'revoke' | null>(null);
  const [changeError, setChangeError] = useState<{ action: 'withdraw' | 'admit' | 'revoke'; message: string } | null>(
    null,
  );
  const mounted = useRef(true);
  const ready = useRef(!blocked);
  const pending = useRef(false);
  const changePending = useRef(false);
  const appointment = request.appointment;
  const recordedAt =
    request.status === 'withdrawn' ? request.withdrawnAt : (appointment?.createdAt ?? request.createdAt);
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
  const change = async (action: 'withdraw' | 'admit' | 'revoke') => {
    if (blocked || changePending.current) return;
    if (action !== 'revoke' && request.status !== 'pending') return;
    if (action === 'admit' && (!accepted || !request.requestedCapabilities.includes('admin'))) return;
    if (action === 'revoke' && (!appointment || appointment.status === 'revoked')) return;
    const epoch = getSessionEpoch();
    const current = () => mounted.current && epoch === getSessionEpoch();
    changePending.current = true;
    setChanging(action);
    setChangeError(null);
    try {
      await (action === 'admit' ? onAdmit : action === 'revoke' ? onRevoke : onWithdraw)();
    } catch (cause) {
      if (current())
        setChangeError({
          action,
          message: apiErrorSentence(
            cause,
            'The request outcome could not be confirmed. Retry the same request or refresh.',
          ),
        });
    } finally {
      changePending.current = false;
      if (current()) setChanging(null);
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
            {request.status === 'withdrawn' ? 'Withdrawn' : request.status === 'admitted' ? 'Admitted' : 'Pending'}
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
          <Row label="Company information (provided by the company)">{request.companyIdentityRaw.name}</Row>
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
            {request.requestedCapabilities.includes('admin') ? (
              <>
                <Text style={styles.text}>{COMPANY_AUTHORITY_DECLARATION}</Text>
                <Text style={styles.muted}>
                  Declaration version {COMPANY_AUTHORITY_DECLARATION_VERSION}. Your appointment uses the exact
                  permissions, delegation and expiry of this request. It does not activate the company or approve any
                  register action.
                </Text>
                <Choice
                  label="Accept authorisation declaration"
                  accessibilityRole="checkbox"
                  selected={accepted}
                  disabled={blocked || !!changing}
                  onPress={() => setAccepted(!accepted)}
                />
                <Action
                  label={changing === 'admit' ? 'Admitting…' : 'Establish appointment'}
                  primary
                  disabled={blocked || !!changing || !accepted}
                  onPress={() => void change('admit')}
                />
              </>
            ) : (
              <Text style={styles.muted}>
                Initial admission requires Manage company team in your own requested permissions. Submit a new request
                with that permission to establish your appointment.
              </Text>
            )}
            <Text style={styles.muted}>
              Withdrawal cancels this proposal. Its history and evidence remain retained.
            </Text>
            <Action
              label={changing === 'withdraw' ? 'Withdrawing…' : 'Withdraw request'}
              disabled={blocked || !!changing}
              onPress={() => void change('withdraw')}
            />
          </View>
        )}
        {appointment && (
          <View style={styles.group}>
            <Rows>
              <Row label="Appointment" mono>
                {appointment.uuid}
              </Row>
              <Row label="Appointment status">{appointment.status}</Row>
              <Row label="Current company authority">{appointment.isEffective ? 'Current' : 'Not current'}</Row>
              <Row label="Admitted at">{formatDateTime(appointment.createdAt)}</Row>
              <Row label="Appointed permissions">{scopeLabels(appointment.capabilities) || 'None'}</Row>
              <Row label="Appointed delegation">{scopeLabels(appointment.delegatableCapabilities) || 'None'}</Row>
              <Row label="Appointment expiry">
                {appointment.expiresAt ? formatDateTime(appointment.expiresAt) : 'None'}
              </Row>
              {appointment.revokedAt && <Row label="Revoked at">{formatDateTime(appointment.revokedAt)}</Row>}
              <Row label="Declaration version">{appointment.declarationVersion}</Row>
            </Rows>
            <Text style={styles.text}>{appointment.declarationText}</Text>
            <Text style={styles.muted}>
              This is your recorded self-declaration. Company information is provided by the company. An appointment
              does not activate the company or approve any register action. Revocation retains its declaration and
              evidence.
            </Text>
            {appointment.status !== 'revoked' && (
              <Action
                label={changing === 'revoke' ? 'Revoking…' : 'Revoke appointment'}
                disabled={blocked || !!changing}
                onPress={() => void change('revoke')}
              />
            )}
          </View>
        )}
        {changeError &&
          (changeError.action === 'revoke' ? appointment?.status !== 'revoked' : request.status === 'pending') && (
            <Text accessibilityRole="alert" style={styles.error}>
              {changeError.message}
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

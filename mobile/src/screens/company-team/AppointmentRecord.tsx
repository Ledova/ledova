import { useLayoutEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import {
  apiErrorSentence,
  COMPANY_AUTHORITY_CAPABILITIES,
  formatDateTime,
  type CompanyCapability,
  type CompanyTeamAppointment,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Action, Disclosure, Row, Rows } from '../../components/Ledger';
import { useCompanyStyles } from '../company-register/styles';

export function scopeLabels(values: CompanyCapability[]) {
  return values
    .map((value) => COMPANY_AUTHORITY_CAPABILITIES.find((item) => item.value === value)?.label ?? value)
    .join(', ');
}

export function AppointmentRecord({
  appointment,
  companyName,
  own,
  blocked,
  guard,
  onRevoke,
}: {
  appointment: OwnCompanyAppointment | CompanyTeamAppointment;
  companyName: string;
  own: boolean;
  blocked: boolean;
  guard: () => void;
  onRevoke: () => Promise<void>;
}) {
  const styles = useCompanyStyles();
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const ready = useRef(false);
  const pending = useRef(false);
  const confirmation = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      confirmation.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    ready.current = !blocked && appointment.status !== 'revoked';
    if (!ready.current) confirmation.current = null;
  }, [blocked, appointment.status]);
  const revoke = async () => {
    if (!live.current || !ready.current || pending.current) return;
    pending.current = true;
    setSending(true);
    setError(null);
    try {
      guard();
      await onRevoke();
      guard();
    } catch (cause) {
      try {
        guard();
        if (live.current)
          setError(apiErrorSentence(cause, 'The revocation could not be confirmed. Refresh or confirm a retry.'));
      } catch {
        return;
      }
    } finally {
      pending.current = false;
      if (live.current) setSending(false);
    }
  };
  const confirm = () => {
    if (!live.current || !ready.current || pending.current || confirmation.current) return;
    try {
      guard();
    } catch {
      return;
    }
    const token = Symbol();
    confirmation.current = token;
    const cancel = () => {
      if (confirmation.current === token) confirmation.current = null;
    };
    Alert.alert(
      'Revoke appointment permanently?',
      `Permanently remove ${own ? 'your' : "this person's"} appointment for ${companyName}? This appointment loses company authority and cannot be restored. ${appointment.source === 'initial' ? 'Another initial self-declaration cannot replace it. ' : ''}Its declaration and history remain retained.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: cancel },
        {
          text: 'Permanently revoke',
          style: 'destructive',
          onPress: () => {
            if (confirmation.current !== token) return;
            confirmation.current = null;
            void revoke();
          },
        },
      ],
      { cancelable: true, onDismiss: cancel },
    );
  };
  const person = 'email' in appointment ? appointment.name || appointment.email : companyName;
  return (
    <Disclosure
      accessibilityLabel={`${own ? 'Your appointment' : 'Team appointment'} ${appointment.uuid}`}
      open={expanded}
      onToggle={() => setExpanded(!expanded)}
      summary={
        <View style={styles.group}>
          <Text style={styles.heading}>{person}</Text>
          <Text style={styles.muted}>
            {appointment.status} · {appointment.isEffective ? 'Current authority' : 'Not current'} ·{' '}
            {appointment.source === 'initial' ? 'Initial declaration' : 'Invitation'}
          </Text>
          <Text style={styles.muted}>{scopeLabels(appointment.capabilities) || 'No personal permissions'}</Text>
        </View>
      }
    >
      <View style={styles.group}>
        <Text style={styles.muted}>{companyName} · Company information provided by the company</Text>
        <Rows>
          {'email' in appointment && <Row label="Email">{appointment.email}</Row>}
          <Row label="Permissions to exercise">{scopeLabels(appointment.capabilities) || 'None'}</Row>
          <Row label="Permissions to delegate">{scopeLabels(appointment.delegatableCapabilities) || 'None'}</Row>
          <Row label="Appointed at">{formatDateTime(appointment.createdAt)}</Row>
          <Row label="Expiry">{appointment.expiresAt ? formatDateTime(appointment.expiresAt) : 'None'}</Row>
          {appointment.revokedAt && <Row label="Revoked at">{formatDateTime(appointment.revokedAt)}</Row>}
          <Row label="Appointment" mono>
            {appointment.uuid}
          </Row>
        </Rows>
        {'declarationText' in appointment && (
          <>
            <Text style={styles.text}>{appointment.declarationText}</Text>
            <Text style={styles.muted}>Recorded declaration version {appointment.declarationVersion}</Text>
          </>
        )}
        {appointment.status !== 'revoked' && (
          <Action
            label={sending ? 'Revoking…' : 'Revoke appointment'}
            accessibilityLabel={`Revoke ${own ? 'your' : 'team'} appointment ${appointment.uuid}`}
            disabled={blocked || sending}
            onPress={confirm}
          />
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

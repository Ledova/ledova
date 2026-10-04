import { useLayoutEffect, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import {
  acceptCompanyTeamInvitation,
  apiErrorSentence,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Action, Choice } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { useCompanyStyles } from '../company-register/styles';
import { scopeLabels } from './AppointmentRecord';

export function AcceptInvitation({
  guard,
  onAccepted,
}: {
  guard: () => void;
  onAccepted: (appointment: OwnCompanyAppointment) => void;
}) {
  const styles = useCompanyStyles();
  const [code, setCode] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [receipt, setReceipt] = useState<OwnCompanyAppointment>();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const live = useRef(true);
  const pending = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const valid = accepted && /^[A-Za-z0-9_-]{43}$/.test(code.trim());
  const send = async () => {
    if (!valid || pending.current) return;
    const submissionGuard = () => {
      guard();
      if (!live.current) throw new Error('Reopen Company team before accepting an invitation.');
    };
    pending.current = true;
    setSending(true);
    setError(null);
    try {
      submissionGuard();
      const response = await acceptCompanyTeamInvitation(apiClient, code.trim(), {
        ledovaSessionEpoch: getSessionEpoch(),
        ledovaSubmissionGuard: submissionGuard,
      });
      submissionGuard();
      const appointment = response.data;
      if (
        !appointment.uuid ||
        !appointment.company ||
        appointment.source !== 'invitation' ||
        appointment.declarationVersion !== COMPANY_AUTHORITY_DECLARATION_VERSION ||
        appointment.declarationText !== COMPANY_AUTHORITY_DECLARATION
      )
        throw new Error('The accepted appointment could not be confirmed. Retry the same code or refresh.');
      setReceipt(appointment);
      setCode('');
      setAccepted(false);
      onAccepted(appointment);
    } catch (cause) {
      try {
        guard();
      } catch {
        return;
      }
      if (live.current)
        setError(
          apiErrorSentence(
            cause,
            'The invitation could not be accepted. Check the code and account requirements, then retry.',
          ),
        );
    } finally {
      pending.current = false;
      if (live.current) setSending(false);
    }
  };
  return (
    <View style={styles.group}>
      <Text style={styles.muted}>
        Paste the code privately supplied by the company. Use your own signed-in account with confirmed email and
        complete any configured identity check. Provider unavailability does not establish an appointment.
      </Text>
      <TextInput
        accessibilityLabel="Invitation code"
        value={code}
        editable={!sending}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
        onChangeText={(value) => {
          setCode(value);
          setAccepted(false);
          setError(null);
          setReceipt(undefined);
        }}
      />
      <Text style={styles.text}>{COMPANY_AUTHORITY_DECLARATION}</Text>
      <Text style={styles.muted}>
        Declaration version {COMPANY_AUTHORITY_DECLARATION_VERSION}. Company information is provided by the company.
        Acceptance records the invitation&apos;s exact permissions and expiry; it does not activate the company or
        approve a register action.
      </Text>
      <Choice
        label="Accept authorisation declaration"
        accessibilityRole="checkbox"
        selected={accepted}
        disabled={sending}
        onPress={() => setAccepted(!accepted)}
      />
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        label={sending ? 'Accepting invitation…' : 'Accept invitation'}
        primary
        disabled={!valid || sending}
        onPress={() => void send()}
      />
      {receipt && (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.text}>
            Appointment recorded for {receipt.companyName}: {receipt.status} ·{' '}
            {receipt.isEffective ? 'Current authority' : 'Not current'}
          </Text>
          <Text style={styles.muted}>Permissions to exercise: {scopeLabels(receipt.capabilities) || 'None'}</Text>
          <Text style={styles.muted}>
            Permissions to delegate: {scopeLabels(receipt.delegatableCapabilities) || 'None'}
          </Text>
        </View>
      )}
    </View>
  );
}

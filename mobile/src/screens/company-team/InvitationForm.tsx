import { useLayoutEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import {
  apiErrorSentence,
  COMPANY_AUTHORITY_CAPABILITIES,
  createCompanyTeamInvitation,
  formatDateTime,
  type CompanyCapability,
  type CompanyTeamInvitationIssued,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Action, Choice, Row, Rows } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { useCompanyStyles } from '../company-register/styles';
import { InvitationDateField } from './InvitationDateField';
import { scopeLabels } from './AppointmentRecord';

export function InvitationForm({
  source,
  canAdmin,
  blocked,
  guard,
  onIssued,
}: {
  source: OwnCompanyAppointment;
  canAdmin: boolean;
  blocked: boolean;
  guard: () => void;
  onIssued: () => void;
}) {
  const styles = useCompanyStyles();
  const [idempotencyKey, setKey] = useState(() => Crypto.randomUUID());
  const [personal, setPersonal] = useState<CompanyCapability[]>([]);
  const [delegatable, setDelegatable] = useState<CompanyCapability[]>([]);
  const [deadline, setDeadline] = useState('');
  const [expiry, setExpiry] = useState('');
  const [issued, setIssued] = useState<CompanyTeamInvitationIssued>();
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const pending = useRef(false);
  const live = useRef(true);
  const ready = useRef(false);
  const disabled = blocked || sending || !!issued;
  const allowed = COMPANY_AUTHORITY_CAPABILITIES.filter(
    ({ value }) => source.delegatableCapabilities.includes(value) && (value !== 'admin' || canAdmin),
  );
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    ready.current = !blocked && source.isEffective && source.status === 'active';
  }, [blocked, source.isEffective, source.status]);
  const reset = () => {
    setKey(Crypto.randomUUID());
    setError(null);
    setIssued(undefined);
  };
  const toggle = (scope: 'personal' | 'delegatable', value: CompanyCapability) => {
    if (disabled || !allowed.some((item) => item.value === value)) return;
    const values = scope === 'personal' ? personal : delegatable;
    const change = scope === 'personal' ? setPersonal : setDelegatable;
    change(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
    reset();
  };
  const send = async () => {
    if (!ready.current || pending.current || issued || personal.length + delegatable.length === 0) return;
    if ([...personal, ...delegatable].some((value) => !allowed.some((item) => item.value === value))) return;
    const epoch = getSessionEpoch();
    const submissionGuard = () => {
      guard();
      if (!live.current || !ready.current) throw new Error('Refresh your appointment before issuing an invitation.');
    };
    pending.current = true;
    setSending(true);
    setError(null);
    try {
      submissionGuard();
      const response = await createCompanyTeamInvitation(
        apiClient,
        {
          company: source.company,
          inviterAppointment: source.uuid,
          idempotencyKey,
          capabilities: personal,
          delegatableCapabilities: delegatable,
          ...(deadline ? { acceptanceDeadline: deadline } : {}),
          ...(expiry ? { appointmentExpiresAt: expiry } : {}),
        },
        { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: submissionGuard },
      );
      guard();
      if (!live.current) return;
      const invitation = response.data;
      const sameScope = (left: CompanyCapability[], right: CompanyCapability[]) =>
        left.length === right.length && right.every((value) => left.includes(value));
      if (
        !invitation.uuid ||
        invitation.company !== source.company ||
        invitation.inviterAppointment !== source.uuid ||
        invitation.idempotencyKey !== idempotencyKey ||
        !sameScope(invitation.capabilities, personal) ||
        !sameScope(invitation.delegatableCapabilities, delegatable) ||
        (deadline && Date.parse(invitation.acceptanceDeadline) !== Date.parse(deadline)) ||
        (expiry
          ? Date.parse(invitation.appointmentExpiresAt ?? '') !== Date.parse(expiry)
          : invitation.appointmentExpiresAt !== null) ||
        !(
          (response.status === 201 &&
            typeof invitation.code === 'string' &&
            /^[A-Za-z0-9_-]{43}$/.test(invitation.code)) ||
          (response.status === 200 && invitation.code === null)
        )
      )
        throw new Error('The invitation outcome could not be confirmed. Retry with the same details.');
      setIssued(invitation);
      onIssued();
    } catch (cause) {
      try {
        guard();
      } catch {
        return;
      }
      if (live.current)
        setError(apiErrorSentence(cause, 'The invitation could not be confirmed. Retry with the same details.'));
    } finally {
      pending.current = false;
      if (live.current) setSending(false);
    }
  };
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>Invite to {source.companyName}</Text>
      <Text style={styles.muted}>Source appointment {source.uuid}</Text>
      <Text style={styles.muted}>
        Choose permissions this person can exercise separately from permissions they can pass on. Both must be within
        this appointment&apos;s delegation scope. Delegation does not personally grant that permission.
      </Text>
      {(
        [
          ['personal', 'Permissions to exercise', personal],
          ['delegatable', 'Permissions to delegate', delegatable],
        ] as const
      ).map(([scope, label, values]) => (
        <View key={scope} style={styles.group}>
          <Text style={styles.heading}>{label}</Text>
          <View style={styles.choices}>
            {allowed.map(({ value, label: capabilityLabel }) => (
              <Choice
                key={value}
                label={capabilityLabel}
                accessibilityRole="checkbox"
                accessibilityLabel={`${label}: ${capabilityLabel}`}
                selected={values.includes(value)}
                disabled={disabled}
                onPress={() => toggle(scope, value)}
              />
            ))}
          </View>
        </View>
      ))}
      <Text style={styles.muted}>
        At least one permission is required. Manage company team is offered only while you have current personal
        administration for this company and the selected source may delegate it. The server rechecks current authority
        before each effect.
      </Text>
      <InvitationDateField
        label="Acceptance deadline"
        value={deadline}
        disabled={disabled}
        onChange={(value) => {
          setDeadline(value);
          reset();
        }}
      />
      <InvitationDateField
        label="Appointment expiry"
        value={expiry}
        disabled={disabled}
        onChange={(value) => {
          setExpiry(value);
          reset();
        }}
      />
      <Text style={styles.muted}>
        Default acceptance deadline: 7 days; maximum: 30 days. Default appointment expiry: none.
      </Text>
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!issued ? (
        <Action
          label={sending ? 'Creating invitation…' : 'Create invitation'}
          primary
          disabled={disabled || personal.length + delegatable.length === 0}
          onPress={() => void send()}
        />
      ) : (
        <View style={styles.group}>
          <Rows>
            <Row label="Invitation" mono>
              {issued.uuid}
            </Row>
            <Row label="Permissions to exercise">{scopeLabels(issued.capabilities) || 'None'}</Row>
            <Row label="Permissions to delegate">{scopeLabels(issued.delegatableCapabilities) || 'None'}</Row>
            <Row label="Accept before">{formatDateTime(issued.acceptanceDeadline)}</Row>
          </Rows>
          {issued.code ? (
            <>
              <Text style={styles.heading}>One-time invitation code</Text>
              <Text selectable accessibilityLabel="One-time invitation code" style={styles.text}>
                {issued.code}
              </Text>
              <Text style={styles.muted}>
                Copy this code now and share it privately with the intended person. It cannot be retrieved later. No
                email is sent.
              </Text>
            </>
          ) : (
            <Text accessibilityRole="alert" style={styles.muted}>
              This invitation was already recorded. Its one-time code cannot be retrieved. If you did not retain it,
              create another invitation.
            </Text>
          )}
          <Action label="Create another invitation" disabled={blocked || sending} onPress={reset} />
        </View>
      )}
    </View>
  );
}

import { Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import {
  COMPANY_AUTHORITY_CAPABILITIES,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  FIELD_LIMITS,
  INVITATION_CODE_PROBLEM,
  isInvitationCode,
  useAcceptInvitationForm,
  useErrorSummary,
  useTeamInvitationForm,
  type CompanyCapability,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Action, FormActions, Outcome } from '../../components/Ledger';
import { Checkbox, Field } from '../../components/register/RegisterFields';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { orderSubmissionSession } from '../../services/orderSubmissions';

function useFormStyles() {
  return useThemedStyles((theme) => ({
    form: { gap: theme.spacing.md },
    group: { gap: theme.spacing.sm },
    legend: { fontFamily: theme.fontFamily.medium, fontSize: 14, lineHeight: 20, color: theme.colors.text.primary },
    value: {
      padding: theme.spacing.smd,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surface.raised,
    },
    code: { fontFamily: theme.fontFamily.mono, fontSize: 16, lineHeight: 22, color: theme.colors.text.primary },
  }));
}

export function AcceptInvitationForm({
  disabled,
  guard,
  onRecorded,
  onBusy,
  onCancel,
}: {
  disabled: boolean;
  guard: () => void;
  onRecorded: () => void;
  onBusy: (value: boolean) => void;
  onCancel: () => void;
}) {
  const styles = useCompanyStyles();
  const look = useFormStyles();
  const { code, setCode, accepted, setAccepted, busy, error, setError, receipt, setReceipt, send } =
    useAcceptInvitationForm({ disabled, guard, onRecorded, onBusy, session: orderSubmissionSession });
  const checks = useErrorSummary({
    code: !isInvitationCode(code) && INVITATION_CODE_PROBLEM,
    accepted: !accepted && 'Accept the company authorisation declaration.',
  });
  const declarationError = checks.field('accepted').error;
  const changeCode = (value: string) => {
    setCode(value);
    setAccepted(false);
    setError('');
    setReceipt('');
  };
  return (
    <View style={look.form}>
      <Text style={styles.muted}>
        Enter the code the company gave you. Acceptance uses your signed-in account and the existing account, email and
        configured identity checks.
      </Text>
      <Field
        label="Invitation code"
        value={code}
        editable={!disabled && !busy}
        autoCapitalize="none"
        autoCorrect={false}
        error={checks.field('code').error}
        onChange={(value) => changeCode(value.trim().slice(0, FIELD_LIMITS.INVITATION_CODE))}
      />
      <Text style={styles.text}>{COMPANY_AUTHORITY_DECLARATION}</Text>
      <Text style={styles.muted}>
        Declaration version {COMPANY_AUTHORITY_DECLARATION_VERSION}. Company information is provided by the company.
      </Text>
      <View>
        <Checkbox
          label="Accept company authorisation declaration"
          checked={accepted}
          disabled={disabled || busy}
          error={declarationError}
          onChange={setAccepted}
        />
        {!!declarationError && <Text style={styles.error}>{declarationError}</Text>}
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!!receipt && <Outcome>{receipt}</Outcome>}
      <FormActions>
        <Action label={receipt ? 'Done' : 'Cancel'} disabled={busy} onPress={onCancel} />
        <Action
          label={busy ? 'Accepting invitation…' : 'Accept invitation'}
          primary
          disabled={disabled || busy}
          onPress={() => {
            if (checks.check()) void send();
          }}
        />
      </FormActions>
    </View>
  );
}

export function TeamInvitationForm({
  source,
  available,
  disabled,
  guard,
  onRecorded,
  onBusy,
  onCancel,
}: {
  source: OwnCompanyAppointment;
  available: CompanyCapability[];
  disabled: boolean;
  guard: () => void;
  onRecorded: () => void;
  onBusy: (value: boolean) => void;
  onCancel: () => void;
}) {
  const styles = useCompanyStyles();
  const look = useFormStyles();
  const {
    personal,
    setPersonal,
    delegatable,
    setDelegatable,
    deadline,
    setDeadline,
    expiry,
    setExpiry,
    busy,
    error,
    problems,
    recorded,
    setRecorded,
    keyRef,
    change,
    toggle,
    send,
  } = useTeamInvitationForm({
    source,
    available,
    disabled,
    guard,
    onRecorded,
    onBusy,
    session: orderSubmissionSession,
    newKey: randomUUID,
  });
  const checks = useErrorSummary(problems);
  if (recorded)
    return (
      <View style={look.form}>
        <Outcome>Invitation recorded.</Outcome>
        {recorded.code ? (
          <>
            <Text style={styles.text}>
              Copy this one-time code now and share it directly with the person you appoint. It will not be shown in
              history.
            </Text>
            <View style={styles.group}>
              <Text style={styles.text}>One-time invitation code</Text>
              <View style={look.value}>
                <Text selectable style={look.code}>
                  {recorded.code}
                </Text>
              </View>
            </View>
          </>
        ) : (
          <Text style={styles.text}>
            No code is available on this retry. Use the original code, or create a new invitation if it was lost.
          </Text>
        )}
        <FormActions>
          <Action label="Done" disabled={disabled} onPress={onCancel} />
          <Action
            label="Create another invitation"
            disabled={disabled}
            onPress={() => {
              keyRef.current = null;
              setRecorded(null);
              setPersonal([]);
              setDelegatable([]);
              setDeadline('');
              setExpiry('');
              checks.reset();
            }}
          />
        </FormActions>
      </View>
    );
  const actionsError = checks.field('actions').error;
  const dates = [
    ['deadline', 'Invitation deadline (UTC)', deadline, setDeadline],
    ['expiry', 'Appointment expiry (UTC)', expiry, setExpiry],
  ] as const;
  return (
    <View style={look.form}>
      <Text style={styles.muted}>
        Personal actions and permission to delegate are separate. Choose only actions your selected appointment may
        delegate.
      </Text>
      {(['personal', 'delegatable'] as const).map((scope) => {
        const values = scope === 'personal' ? personal : delegatable;
        const set = scope === 'personal' ? setPersonal : setDelegatable;
        return (
          <View key={scope} style={look.group}>
            <Text accessibilityRole="header" style={look.legend}>
              {scope === 'personal' ? 'Actions for the appointee' : 'Actions the appointee may delegate'}
            </Text>
            {COMPANY_AUTHORITY_CAPABILITIES.filter(({ value }) => available.includes(value)).map(({ value, label }) => (
              <Checkbox
                key={value}
                label={label}
                checked={values.includes(value)}
                disabled={disabled || busy}
                error={actionsError}
                onChange={() => change(() => set(toggle(values, value)))}
              />
            ))}
          </View>
        );
      })}
      {!!actionsError && <Text style={styles.error}>{actionsError}</Text>}
      {dates.map(([key, label, value, set]) => (
        <Field
          key={key}
          label={label}
          value={value}
          placeholder="YYYY-MM-DD"
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled && !busy}
          error={checks.field(key).error}
          onChange={(text) => change(() => set(text.trim()))}
        />
      ))}
      <Text style={styles.muted}>
        The default acceptance deadline is seven days. A chosen deadline must be within 30 days.
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <FormActions>
        <Action label="Cancel" disabled={busy} onPress={onCancel} />
        <Action
          label={busy ? 'Creating invitation…' : 'Create invitation'}
          primary
          disabled={disabled || busy}
          onPress={() => {
            if (checks.check()) void send();
          }}
        />
      </FormActions>
    </View>
  );
}

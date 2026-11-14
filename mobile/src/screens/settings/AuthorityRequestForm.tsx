import { Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import {
  COMPANY_AUTHORITY_CAPABILITIES,
  failureSentence,
  useAuthorityRequestForm,
  useErrorSummary,
  type CompanyAuthorityRequest,
  type CompanyListItem,
} from '@ledova/shared';
import { Action, FormActions } from '../../components/Ledger';
import { Checkbox, Field, FileField } from '../../components/Field';
import { useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { orderSubmissionSession } from '../../services/orderSubmissions';

export function AuthorityRequestForm({
  company,
  disabled,
  guard,
  onSuccess,
  onCancel,
}: {
  company: CompanyListItem;
  disabled: boolean;
  guard: () => void;
  onSuccess: (request: CompanyAuthorityRequest) => void;
  onCancel: () => void;
}) {
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({
    form: { gap: theme.spacing.md },
    group: { gap: theme.spacing.sm },
    legend: { fontFamily: theme.fontFamily.medium, fontSize: 14, lineHeight: 20, color: theme.colors.text.primary },
  }));
  const {
    file,
    setFile,
    requested,
    setRequested,
    delegatable,
    setDelegatable,
    expiry,
    setExpiry,
    submission,
    change,
    busy,
    problems,
    toggle,
    send,
  } = useAuthorityRequestForm({
    company,
    disabled,
    guard,
    onSuccess,
    session: orderSubmissionSession,
    newKey: randomUUID,
  });
  const checks = useErrorSummary(problems);
  const actionsError = checks.field('actions').error;
  const unavailable = disabled || busy;
  return (
    <View style={look.form}>
      <Text style={styles.muted}>
        Company information is provided by the company. Submit a private request for your own representative role at{' '}
        {company.name}, then accept the authorisation declaration to establish your appointment. Submitting evidence
        alone grants no authority and does not activate the company.
      </Text>
      <Text style={styles.muted}>
        Initial admission requires Manage company information and team in your own requested actions. Your evidence and
        request history remain private to your account; no ASIC extract is required.
      </Text>
      {(['requested', 'delegatable'] as const).map((scope) => {
        const values = scope === 'requested' ? requested : delegatable;
        const set = scope === 'requested' ? setRequested : setDelegatable;
        return (
          <View key={scope} style={look.group}>
            <Text accessibilityRole="header" style={look.legend}>
              {scope === 'requested'
                ? 'Actions you request for yourself'
                : 'Actions you request permission to delegate'}
            </Text>
            {COMPANY_AUTHORITY_CAPABILITIES.map(({ value, label }) => (
              <Checkbox
                key={value}
                label={label}
                checked={values.includes(value)}
                disabled={unavailable}
                error={actionsError}
                onChange={() => change(() => set(toggle(values, value)))}
              />
            ))}
          </View>
        );
      })}
      {!!actionsError && <Text style={styles.error}>{actionsError}</Text>}
      <Field
        label="Expiry date (UTC)"
        value={expiry}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!unavailable}
        error={checks.field('expiry').error}
        onChange={(text) => change(() => setExpiry(text.trim()))}
      />
      <FileField
        label="Supporting document"
        value={file}
        disabled={unavailable}
        onFile={(file) => change(() => setFile(file && { uri: file.uri, name: file.name, type: file.type }))}
      />
      {submission.isError && (
        <Text accessibilityRole="alert" style={styles.error}>
          {failureSentence(submission.error, 'The request could not be recorded. Retry with the same details.')}
        </Text>
      )}
      <FormActions>
        <Action label="Cancel" disabled={unavailable} onPress={onCancel} />
        <Action
          label={busy ? 'Submitting…' : 'Submit authority request'}
          primary
          disabled={unavailable}
          onPress={() => {
            if (checks.check()) void send();
          }}
        />
      </FormActions>
    </View>
  );
}

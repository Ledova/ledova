import { Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { Action } from '../Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { useRegisterEvidence } from '../../hooks/useRegisterEvidence';

export const utcToday = () => new Date().toISOString().slice(0, 10);

export function isoDay(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return (
    !!match &&
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toISOString().startsWith(value)
  );
}

export function Field({
  label,
  accessibilityLabel,
  value,
  editable,
  keyboardType,
  multiline,
  maxLength,
  clearable,
  error,
  onChange,
}: {
  label: string;
  accessibilityLabel?: string;
  value: string;
  editable: boolean;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  maxLength?: number;
  clearable?: boolean;
  error?: string | null;
  onChange: (value: string) => void;
}) {
  const styles = useCompanyStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.text}>{label}</Text>
      <TextInput
        clearButtonMode={clearable ? 'while-editing' : undefined}
        accessibilityLabel={accessibilityLabel ?? label}
        style={styles.input}
        value={value}
        editable={editable}
        keyboardType={keyboardType}
        multiline={multiline}
        maxLength={maxLength}
        accessibilityHint={error ?? undefined}
        onChangeText={onChange}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

export function EvidencePicker({
  title,
  noun,
  evidence,
  disabled,
  error,
  onPick,
}: {
  title: string;
  noun: string;
  evidence: ReturnType<typeof useRegisterEvidence>;
  disabled: boolean;
  error?: string | null;
  onPick: () => void;
}) {
  const styles = useCompanyStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.heading}>{title}</Text>
      <Text style={styles.muted}>
        {evidence.name
          ? `${evidence.name}${evidence.uploaded ? ' · uploaded' : ''}`
          : 'Choose a PDF, PNG or JPEG up to 10 MB.'}
      </Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Action label={`${evidence.name ? 'Replace' : 'Choose'} the ${noun}`} disabled={disabled} onPress={onPick} />
      {!!evidence.name && <Action label={`Remove the ${noun}`} disabled={disabled} onPress={evidence.clear} />}
    </View>
  );
}

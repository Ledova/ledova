import { Text, TextInput, View, type KeyboardTypeOptions, type TextInputProps } from 'react-native';
import { useAppTheme } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';

export function Field({
  label,
  accessibilityLabel,
  value,
  editable,
  keyboardType,
  multiline,
  rows = 2,
  maxLength,
  placeholder,
  clearable,
  autoCapitalize,
  autoCorrect,
  error,
  onChange,
}: {
  label: string;
  accessibilityLabel?: string;
  value: string;
  editable: boolean;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  clearable?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoCorrect?: boolean;
  error?: string | null;
  onChange: (value: string) => void;
}) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  return (
    <View style={styles.group}>
      <Text style={styles.text}>{label}</Text>
      <TextInput
        clearButtonMode={clearable ? 'while-editing' : undefined}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: !editable }}
        style={[
          styles.input,
          multiline && { minHeight: rows * 22 + 2 * theme.spacing.smd, textAlignVertical: 'top' as const },
        ]}
        value={value}
        editable={editable}
        keyboardType={keyboardType}
        multiline={multiline}
        maxLength={maxLength}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.form.placeholder}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        accessibilityHint={error ?? undefined}
        onChangeText={onChange}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

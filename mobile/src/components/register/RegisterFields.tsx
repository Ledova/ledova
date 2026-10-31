import { Pressable, Text, TextInput, View, type KeyboardTypeOptions, type TextInputProps } from 'react-native';
import { CheckIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../../contexts';
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

export function CheckboxField({
  label,
  checked,
  disabled = false,
  error,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  error?: string | null;
  onChange: (checked: boolean) => void;
}) {
  const theme = useAppTheme();
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({
    row: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: theme.spacing.sm },
    box: {
      width: 18,
      height: 18,
      marginTop: 1.5,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderWidth: 1.5,
      borderColor: theme.colors.text.muted,
      borderRadius: theme.borderRadius.sm,
    },
    checked: { borderColor: theme.colors.brand.default, backgroundColor: theme.colors.brand.default },
    label: { flex: 1 },
    off: { opacity: 0.5 },
  }));
  const toggle = () => {
    if (!disabled) onChange(!checked);
  };
  return (
    <View style={styles.group}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        accessibilityHint={error ?? undefined}
        disabled={disabled}
        onPress={toggle}
        onAccessibilityTap={toggle}
        style={[look.row, disabled && look.off]}
      >
        <View style={[look.box, checked && look.checked]}>
          {checked && <CheckIcon size={12} weight="bold" color={theme.colors.utility.white} />}
        </View>
        <Text style={[styles.text, look.label]}>{label}</Text>
      </Pressable>
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

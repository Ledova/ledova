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
  autoFocus,
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
  autoFocus?: boolean;
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
        autoFocus={autoFocus}
        accessibilityHint={error ?? undefined}
        onChangeText={onChange}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

export function Checkbox({
  label,
  checked,
  disabled,
  error,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  error: string | null;
  onChange: (checked: boolean) => void;
}) {
  const theme = useAppTheme();
  const look = useThemedStyles((theme) => ({
    choice: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
    },
    box: {
      width: 20,
      height: 20,
      marginTop: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.sm,
      backgroundColor: theme.colors.surface.raised,
    },
    ticked: { borderColor: theme.colors.brand.default, backgroundColor: theme.colors.brand.default },
    label: {
      flex: 1,
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      lineHeight: 22,
      color: theme.colors.text.primary,
    },
    disabled: { opacity: 0.5 },
  }));
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityHint={error ?? undefined}
      disabled={disabled}
      hitSlop={4}
      onPress={() => onChange(!checked)}
      style={[look.choice, disabled && look.disabled]}
    >
      <View style={[look.box, checked && look.ticked]}>
        {checked && <CheckIcon size={theme.icon.sizes.sm} color={theme.colors.utility.white} weight="bold" />}
      </View>
      <Text style={look.label}>{label}</Text>
    </Pressable>
  );
}

import { Pressable, Text, TextInput, View, type KeyboardTypeOptions, type TextInputProps } from 'react-native';
import { CheckIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { usePickedDocument } from '../../hooks/usePickedDocument';
import type { PickedDocument } from '../../services/documentCopies';

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

export function FileField({
  label,
  hint,
  disabled,
  error,
  onFile,
}: {
  label: string;
  hint?: string;
  disabled: boolean;
  error?: string | null;
  onFile: (file: PickedDocument | null) => void;
}) {
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({
    file: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.smd,
      padding: theme.spacing.smd,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surface.raised,
    },
    choose: { fontFamily: theme.fontFamily.regular, fontSize: 16, color: theme.colors.text.primary },
    filename: { flex: 1, fontFamily: theme.fontFamily.regular, fontSize: 16, color: theme.colors.text.muted },
    off: { opacity: 0.5 },
  }));
  const picked = usePickedDocument(onFile);
  const unavailable = disabled || picked.isPicking;
  const problem = picked.refusal ?? error;
  return (
    <View style={styles.group}>
      <Text style={styles.text}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={picked.file ? `${label}, ${picked.file.name}. Choose file` : `${label}. Choose file`}
        accessibilityState={{ disabled: unavailable }}
        accessibilityHint={problem ?? undefined}
        disabled={unavailable}
        onPress={() => void picked.choose()}
        style={[look.file, unavailable && look.off]}
      >
        <Text style={look.choose}>Choose file</Text>
        {!!picked.file && (
          <Text numberOfLines={1} style={look.filename}>
            {picked.file.name}
          </Text>
        )}
      </Pressable>
      {!!hint && <Text style={styles.muted}>{hint}</Text>}
      {!!problem && (
        <Text accessibilityRole={picked.refusal ? 'alert' : undefined} style={styles.error}>
          {problem}
        </Text>
      )}
    </View>
  );
}

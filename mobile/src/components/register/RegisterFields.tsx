import { forwardRef, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CheckIcon } from 'phosphor-react-native';
import type { UploadFile } from '@ledova/shared';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { Input, type InputProps, type InputRef } from '../Input';
import { usePickedDocument } from '../../hooks/usePickedDocument';
import type { PickedDocument } from '../../services/documentCopies';

type FieldProps = Omit<InputProps, 'onChange' | 'onChangeText' | 'invalid' | 'leading' | 'style'> & {
  label: string;
  hint?: string;
  error?: string | null;
  /** Shows the clear button while editing. */
  clearable?: boolean;
  /** Icon or control before the text. */
  icon?: ReactNode;
  onChange: (value: string) => void;
};

/** A labelled text field: the shared `Input` with its label, hint and error. */
export const Field = forwardRef<InputRef, FieldProps>(function Field(
  { label, hint, error, clearable, icon, filled, accessibilityLabel, onChange, ...input },
  ref,
) {
  const styles = useCompanyStyles();
  const note = !!hint && <Text style={filled ? styles.filledHint : styles.muted}>{hint}</Text>;
  return (
    <View style={[styles.group, filled && styles.filledGroup]}>
      <Text style={filled ? styles.filledLabel : styles.text}>{label}</Text>
      {filled && note}
      <Input
        ref={ref}
        {...input}
        filled={filled}
        invalid={!!error}
        leading={icon}
        clearButtonMode={clearable ? 'while-editing' : input.clearButtonMode}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={error ?? input.accessibilityHint}
        onChangeText={onChange}
      />
      {!filled && note}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
});

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
  accessibilityLabel = label,
  hint,
  disabled,
  error,
  value,
  onFile,
}: {
  label: string;
  accessibilityLabel?: string;
  hint?: string;
  disabled: boolean;
  error?: string | null;
  value: UploadFile | null | undefined;
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
  const picked = usePickedDocument(value, onFile);
  const unavailable = disabled || picked.isPicking;
  const problem = picked.refusal ?? error;
  return (
    <View style={styles.group}>
      <Text style={styles.text}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          picked.file ? `${accessibilityLabel}, ${picked.file.name}. Choose file` : `${accessibilityLabel}. Choose file`
        }
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

export function Choices<T extends string>({
  legend,
  options,
  value,
  onChange,
  disabled = false,
}: {
  legend: string;
  options: readonly (readonly [T, string])[];
  value: T | '';
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({
    options: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      columnGap: 20,
      rowGap: theme.spacing.sm,
    },
    choice: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
    },
    mark: {
      width: 18,
      height: 18,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: 9,
      backgroundColor: theme.colors.surface.raised,
    },
    marked: { borderColor: theme.colors.brand.default },
    dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.brand.default },
    label: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 22, color: theme.colors.text.primary },
    disabled: { opacity: 0.5 },
  }));
  return (
    <View style={styles.group}>
      <Text style={styles.text}>{legend}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={legend} style={look.options}>
        {options.map(([option, label]) => {
          const checked = value === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked, disabled }}
              disabled={disabled}
              hitSlop={4}
              onPress={() => onChange(option)}
              style={[look.choice, disabled && look.disabled]}
            >
              <View style={[look.mark, checked && look.marked]}>{checked && <View style={look.dot} />}</View>
              <Text style={look.label}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

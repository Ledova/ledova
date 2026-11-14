import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CaretDownIcon, CheckIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../contexts';
import { useCompanyStyles } from '../hooks/useCompanyStyles';
import { useControlFrame } from './Input';

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  error,
  filled = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; reference?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  error?: string | null;
  filled?: boolean;
}) {
  const theme = useAppTheme();
  const form = useCompanyStyles();
  const frame = useControlFrame();
  const styles = useThemedStyles((theme) => ({
    open: { borderColor: theme.colors.brand.mid },
    disabled: { opacity: 0.5 },
    value: { flex: 1 },
    options: {
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
      overflow: 'hidden' as const,
    },
    option: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.sm,
      padding: theme.spacing.smd,
    },
    chosen: { backgroundColor: theme.colors.surface.tertiary },
    filledOption: { paddingHorizontal: theme.spacing.md },
  }));
  const [open, setOpen] = useState(false);
  const labelOf = (option: (typeof options)[number]) =>
    option.reference && options.filter(({ label }) => label === option.label).length > 1
      ? `${option.label} · ${option.reference}`
      : option.label;
  const picked = options.find((option) => option.value === value);
  const current = picked ? labelOf(picked) : '';
  return (
    <View style={[form.group, filled && form.filledGroup]}>
      <Text style={filled ? form.filledLabel : form.text}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current}`}
        accessibilityState={{ expanded: open, disabled }}
        accessibilityHint={error ?? undefined}
        disabled={disabled}
        onPress={() => setOpen((shown) => !shown)}
        style={[frame.frame, filled && frame.filled, open && styles.open, disabled && styles.disabled]}
      >
        <Text numberOfLines={1} style={[frame.text, styles.value]}>
          {current}
        </Text>
        <CaretDownIcon size={theme.icon.sizes.sm} color={theme.colors.text.primary} />
      </Pressable>
      {open && !disabled && (
        <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.options}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={[styles.option, filled && styles.filledOption, selected && styles.chosen]}
              >
                <Text style={[frame.text, styles.value]}>{labelOf(option)}</Text>
                {selected && <CheckIcon size={theme.icon.sizes.sm} color={theme.colors.brand.light} />}
              </Pressable>
            );
          })}
        </View>
      )}
      {!!error && <Text style={form.error}>{error}</Text>}
    </View>
  );
}

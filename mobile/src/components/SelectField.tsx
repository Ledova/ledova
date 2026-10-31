import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { CaretDownIcon, CheckIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../contexts';
import { useCompanyStyles } from '../hooks/useCompanyStyles';

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const theme = useAppTheme();
  const form = useCompanyStyles();
  const styles = useThemedStyles((theme) => ({
    control: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.sm,
      padding: theme.spacing.smd,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surface.raised,
    },
    open: { borderColor: theme.colors.brand.mid },
    disabled: { opacity: 0.5 },
    value: { flex: 1, fontFamily: theme.fontFamily.regular, fontSize: 16, color: theme.colors.text.primary },
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
  }));
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value)?.label ?? '';
  return (
    <View style={form.group}>
      <Text style={form.text}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current}`}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen((shown) => !shown)}
        style={[styles.control, open && styles.open, disabled && styles.disabled]}
      >
        <Text style={styles.value}>{current}</Text>
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
                style={[styles.option, selected && styles.chosen]}
              >
                <Text style={styles.value}>{option.label}</Text>
                {selected && <CheckIcon size={theme.icon.sizes.sm} color={theme.colors.brand.light} />}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

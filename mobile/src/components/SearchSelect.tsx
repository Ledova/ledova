import { useMemo, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { CaretDownIcon, CheckIcon } from 'phosphor-react-native';
import { formatShareCount, searchEntries, searchMatches, type SearchChoice } from '@ledova/shared';
import { useAppTheme, useThemedStyles } from '../contexts';
import { useCompanyStyles } from '../hooks/useCompanyStyles';

const SHOWN = 50;
const NONE: readonly SearchChoice[] = [];
const OPTIONS = ['option', 'options'] as const;

export function SearchSelect({
  label,
  choices,
  value,
  onChange,
  first = NONE,
  placeholder = 'Type to search',
  noun = OPTIONS,
  disabled = false,
  error,
}: {
  label: string;
  choices: readonly SearchChoice[];
  value: string;
  onChange: (value: string) => void;
  first?: readonly SearchChoice[];
  placeholder?: string;
  noun?: readonly [string, string];
  disabled?: boolean;
  error?: string | null;
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
    placeholder: { color: theme.colors.form.placeholder },
    options: {
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
      overflow: 'hidden' as const,
    },
    search: {
      margin: theme.spacing.sm,
      paddingHorizontal: 12,
      paddingVertical: theme.spacing.sm,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surface.raised,
      fontFamily: theme.fontFamily.regular,
      fontSize: 16,
      color: theme.colors.text.primary,
    },
    option: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: theme.spacing.sm,
      paddingHorizontal: 12,
      paddingVertical: theme.spacing.sm,
    },
    chosen: { backgroundColor: theme.colors.surface.tertiary },
    tick: { marginTop: 2 },
    other: { opacity: 0 },
    text: { flex: 1, minWidth: 0 },
    name: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 20, color: theme.colors.text.primary },
    detail: { fontFamily: theme.fontFamily.regular, fontSize: 12, lineHeight: 16, color: theme.colors.text.muted },
    note: {
      paddingHorizontal: 12,
      paddingVertical: theme.spacing.sm,
      fontFamily: theme.fontFamily.regular,
      fontSize: 12,
      lineHeight: 16,
      color: theme.colors.text.muted,
    },
  }));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchable = useMemo(() => searchEntries(choices), [choices]);
  const matches = searchMatches(searchable, query);
  const found = matches ?? choices;
  const chosen = [...first, ...choices].find((choice) => choice.value === value);
  const listed = [...(matches ? [] : first), ...found.slice(0, SHOWN), ...(matches && !found.length ? first : [])];
  const counted = (count: number) => `${formatShareCount(String(count))} ${count === 1 ? noun[0] : noun[1]}`;
  const close = () => {
    Keyboard.dismiss();
    setOpen(false);
    setQuery('');
  };
  return (
    <View style={form.group}>
      <Text style={form.text}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${chosen?.label ?? 'none chosen'}`}
        accessibilityState={{ expanded: open, disabled }}
        accessibilityHint={error ?? undefined}
        disabled={disabled}
        onPress={() => (open ? close() : setOpen(true))}
        style={[styles.control, open && styles.open, disabled && styles.disabled]}
      >
        <Text numberOfLines={1} style={[styles.value, !chosen && styles.placeholder]}>
          {chosen?.label ?? placeholder}
        </Text>
        <CaretDownIcon size={theme.icon.sizes.sm} color={theme.colors.text.primary} />
      </Pressable>
      {open && !disabled && (
        <View style={styles.options}>
          <TextInput
            accessibilityLabel={`Search ${label.toLowerCase()}`}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.form.placeholder}
            value={query}
            autoCorrect={false}
            onChangeText={setQuery}
            style={styles.search}
          />
          <View accessibilityRole="radiogroup" accessibilityLabel={label}>
            {listed.map((choice) => {
              const selected = choice.value === value;
              return (
                <Pressable
                  key={choice.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={choice.detail ? `${choice.label} · ${choice.detail}` : choice.label}
                  onPress={() => {
                    if (!selected) onChange(choice.value);
                    close();
                  }}
                  style={[styles.option, selected && styles.chosen]}
                >
                  <View style={[styles.tick, !selected && styles.other]}>
                    <CheckIcon size={16} color={theme.colors.text.primary} />
                  </View>
                  <View style={styles.text}>
                    <Text style={styles.name}>{choice.label}</Text>
                    {!!choice.detail && <Text style={styles.detail}>{choice.detail}</Text>}
                  </View>
                </Pressable>
              );
            })}
          </View>
          {!!matches && found.length === 0 && (
            <Text accessibilityLiveRegion="polite" style={styles.note}>
              No {noun[1]} match “{query.trim()}”.
            </Text>
          )}
          {found.length > SHOWN && (
            <Text style={styles.note}>
              Showing the first {SHOWN} of {counted(found.length)}. Type more to narrow the list.
            </Text>
          )}
        </View>
      )}
      {!!error && <Text style={form.error}>{error}</Text>}
    </View>
  );
}

import { useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { CaretDownIcon, CheckIcon } from 'phosphor-react-native';
import { formatShareCount, searchEntries, searchMatches, type SearchChoice } from '@ledova/shared';
import { overlayColors, useAppTheme, useThemedStyles } from '../contexts';
import { Action, useCardStyles } from './Ledger';
import { useDialogInsets, useDialogStyles } from './modal/CustomModal';

const NONE: readonly SearchChoice[] = [];

export function SearchSelect({
  label,
  choices,
  value,
  onChange,
  first = NONE,
  placeholder = 'Type to search',
  disabled = false,
  noun = ['option', 'options'],
  error,
}: {
  label: string;
  choices: readonly SearchChoice[];
  value: string;
  onChange: (value: string) => void;
  first?: readonly SearchChoice[];
  placeholder?: string;
  disabled?: boolean;
  noun?: readonly [string, string];
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const theme = useAppTheme();
  const insets = useDialogInsets();
  const card = useCardStyles();
  const dialog = useDialogStyles();
  const styles = useThemedStyles((current) => ({
    field: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: current.spacing.sm,
      borderWidth: 1,
      borderColor: current.colors.border.default,
      borderRadius: current.borderRadius.md,
      backgroundColor: current.colors.surface.raised,
      paddingHorizontal: current.spacing.smd,
      paddingVertical: current.spacing.smd,
      opacity: disabled ? 0.5 : 1,
    },
    fieldText: { flex: 1 },
    overlay: { flex: 1, backgroundColor: overlayColors.modal },
    keyboard: { flex: 1 },
    position: {
      flex: 1,
      paddingTop: insets.top + current.spacing.md,
      paddingRight: insets.right + current.spacing.md,
      paddingBottom: insets.bottom + current.spacing.md,
      paddingLeft: insets.left + current.spacing.md,
      alignItems: 'center' as const,
    },
    sheet: { flex: 1, width: '100%' as const, maxWidth: 520 },
    header: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: current.spacing.sm,
    },
    title: { flex: 1 },
    list: { flex: 1 },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: current.spacing.sm,
      paddingVertical: current.spacing.smd,
      borderTopWidth: 1,
      borderTopColor: current.colors.border.default,
    },
    rowText: { flex: 1 },
    check: { width: 16 },
    unavailable: { opacity: 0.6 },
  }));
  const known = useMemo(
    () => new Map([...first, ...choices].map((choice) => [choice.value, choice])),
    [first, choices],
  );
  const entries = useMemo(() => searchEntries(choices), [choices]);
  const matches = searchMatches(entries, query);
  const typed = matches !== null;
  const found = matches ?? choices;
  const matched = typed && found.some((choice) => !choice.unavailable);
  const rows = !typed ? [...first, ...choices] : matched ? found : [...found, ...first];
  const counted = (count: number) => `${formatShareCount(String(count))} ${count === 1 ? noun[0] : noun[1]}`;
  const searched = query.trim();
  const status = !typed
    ? ''
    : found.length
      ? `${counted(found.length)} ${found.length === 1 ? 'matches' : 'match'} “${searched}”.`
      : `No ${noun[1]} match “${searched}”.`;
  const current = known.get(value);
  const close = () => setOpen(false);
  const choose = (choice: SearchChoice) => {
    if (choice.unavailable) return;
    close();
    if (choice.value !== value) onChange(choice.value);
  };
  return (
    <View style={dialog.group}>
      <Text style={dialog.text}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current ? [current.label, current.detail].filter(Boolean).join(' · ') : 'none chosen'}`}
        accessibilityHint={[error, 'Opens a list to search and choose'].filter(Boolean).join(' ')}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => {
          setQuery('');
          setOpen(true);
        }}
        style={styles.field}
      >
        <View style={styles.fieldText}>
          <Text style={current ? dialog.text : dialog.muted}>{current?.label ?? placeholder}</Text>
          {!!current?.detail && <Text style={dialog.muted}>{current.detail}</Text>}
        </View>
        <CaretDownIcon size={16} color={theme.colors.text.muted} />
      </Pressable>
      {!!error && <Text style={dialog.error}>{error}</Text>}
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.overlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboard}
            pointerEvents="box-none"
          >
            <View style={styles.position} pointerEvents="box-none">
              <View accessibilityViewIsModal style={[card.card, styles.sheet]}>
                <View style={styles.header}>
                  <Text accessibilityRole="header" style={[card.title, styles.title]}>
                    {label}
                  </Text>
                  <Action label="Close" accessibilityLabel={`Close ${label}`} onPress={close} />
                </View>
                <TextInput
                  accessibilityLabel={`Search ${noun[1]}`}
                  style={dialog.field}
                  value={query}
                  placeholder={placeholder}
                  placeholderTextColor={theme.colors.text.muted}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                  returnKeyType="search"
                  onChangeText={setQuery}
                />
                {!!status && (
                  <Text accessibilityLiveRegion="polite" style={dialog.muted}>
                    {status}
                  </Text>
                )}
                <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.list}>
                  <FlatList
                    data={rows}
                    keyExtractor={(choice) => choice.value}
                    keyboardShouldPersistTaps="handled"
                    keyboardDismissMode="on-drag"
                    initialNumToRender={20}
                    renderItem={({ item }) => {
                      const detail = [item.detail, item.unavailable].filter(Boolean).join(' · ');
                      const selected = item.value === value;
                      return (
                        <Pressable
                          accessibilityRole="radio"
                          accessibilityLabel={detail ? `${item.label} · ${detail}` : item.label}
                          accessibilityState={{ checked: selected, disabled: !!item.unavailable }}
                          disabled={!!item.unavailable}
                          onPress={() => choose(item)}
                          style={[styles.row, item.unavailable ? styles.unavailable : null]}
                        >
                          <View style={styles.check}>
                            {selected && <CheckIcon size={16} color={theme.colors.text.primary} />}
                          </View>
                          <View style={styles.rowText}>
                            <Text style={dialog.text}>{item.label}</Text>
                            {!!detail && <Text style={dialog.muted}>{detail}</Text>}
                          </View>
                        </Pressable>
                      );
                    }}
                  />
                </View>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

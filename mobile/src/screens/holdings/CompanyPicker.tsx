import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { CheckIcon } from 'phosphor-react-native';
import { searchRows, type OwnershipCompany } from '@ledova/shared';
import { useAppTheme, useThemedStyles } from '../../contexts';

function usePickerStyles() {
  return useThemedStyles((theme) => ({
    input: {
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
    list: { marginTop: theme.spacing.sm },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      gap: theme.spacing.sm,
      paddingHorizontal: 12,
      paddingVertical: theme.spacing.sm,
    },
    current: { backgroundColor: theme.colors.surface.tertiary },
    tick: { marginTop: 2 },
    other: { opacity: 0 },
    text: { flex: 1, minWidth: 0 },
    name: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.sm,
      lineHeight: 20,
      color: theme.colors.text.primary,
    },
    detail: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.xs,
      lineHeight: 16,
      color: theme.colors.text.muted,
    },
    none: {
      paddingHorizontal: 12,
      paddingVertical: theme.spacing.sm,
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.sm,
      lineHeight: 20,
      color: theme.colors.text.muted,
    },
  }));
}

function detailOf(company: OwnershipCompany) {
  return [
    company.canManage ? 'Company administrator' : company.canReadRegister ? 'Company access' : null,
    company.memberUuids.length ? 'Member' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function CompanyPicker({
  companies,
  current,
  onChoose,
}: {
  companies: OwnershipCompany[];
  current: string;
  onChoose: (companyUuid: string) => void;
}) {
  const theme = useAppTheme();
  const styles = usePickerStyles();
  const [query, setQuery] = useState('');
  const found = searchRows(companies, (row) => `${row.name} ${detailOf(row)}`, query);
  return (
    <View>
      <TextInput
        accessibilityLabel="Your companies"
        placeholder="Type a company name"
        placeholderTextColor={theme.colors.text.muted}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        style={styles.input}
      />
      <View style={styles.list}>
        {found.length === 0 ? (
          <Text accessibilityLiveRegion="polite" style={styles.none}>
            No companies match “{query.trim()}”.
          </Text>
        ) : (
          found.map((row) => {
            const selected = row.uuid === current;
            const detail = detailOf(row);
            return (
              <Pressable
                key={row.uuid}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={detail ? `${row.name}, ${detail}` : row.name}
                onPress={() => onChoose(row.uuid)}
                style={[styles.row, selected && styles.current]}
              >
                <View style={[styles.tick, !selected && styles.other]}>
                  <CheckIcon size={16} color={theme.colors.text.primary} />
                </View>
                <View style={styles.text}>
                  <Text style={styles.name}>{row.name}</Text>
                  {!!detail && <Text style={styles.detail}>{detail}</Text>}
                </View>
              </Pressable>
            );
          })
        )}
      </View>
    </View>
  );
}

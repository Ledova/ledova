import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { CheckIcon, MagnifyingGlassIcon } from 'phosphor-react-native';
import { searchRows, type OwnMemberRecord } from '@ledova/shared';
import { Rows } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { useAppTheme, useThemedStyles } from '../../contexts';

const SEARCH_ABOVE = 6;

function usePickerStyles() {
  return useThemedStyles((theme) => ({
    search: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.smd,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surface.raised,
    },
    input: {
      flex: 1,
      paddingVertical: theme.spacing.smd,
      fontFamily: theme.fontFamily.regular,
      fontSize: 16,
      color: theme.colors.text.primary,
    },
    row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.smd, paddingVertical: 12 },
    text: { flex: 1, gap: 2 },
    name: { fontFamily: theme.fontFamily.medium, fontSize: 15, color: theme.colors.text.primary },
    detail: { fontFamily: theme.fontFamily.regular, fontSize: 13, color: theme.colors.text.muted },
  }));
}

export function CompanyPicker({
  visible,
  companies,
  current,
  onChoose,
  onClose,
}: {
  visible: boolean;
  companies: OwnMemberRecord[];
  current: string | undefined;
  onChoose: (companyUuid: string) => void;
  onClose: () => void;
}) {
  const theme = useAppTheme();
  const styles = usePickerStyles();
  const [query, setQuery] = useState('');
  const found = searchRows(companies, (row) => row.company.name, query);
  return (
    <CustomModal visible={visible} title="Switch company" onClose={onClose}>
      {companies.length > SEARCH_ABOVE && (
        <View style={styles.search}>
          <MagnifyingGlassIcon size={16} color={theme.colors.text.muted} />
          <TextInput
            accessibilityLabel="Search your companies"
            placeholder="Search your companies"
            placeholderTextColor={theme.colors.text.muted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            style={styles.input}
          />
        </View>
      )}
      {found.length === 0 ? (
        <Text style={styles.detail}>No companies match your search.</Text>
      ) : (
        <Rows>
          {found.map((row) => {
            const selected = row.company.uuid === current;
            return (
              <Pressable
                key={row.uuid}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${row.company.name}, Member`}
                onPress={() => onChoose(row.company.uuid)}
                style={styles.row}
              >
                <View style={styles.text}>
                  <Text style={styles.name}>{row.company.name}</Text>
                  <Text style={styles.detail}>Member</Text>
                </View>
                {selected && <CheckIcon size={theme.icon.sizes.md} color={theme.colors.brand.light} />}
              </Pressable>
            );
          })}
        </Rows>
      )}
    </CustomModal>
  );
}

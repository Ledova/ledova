import { useRef } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';
import { WALLET_SORTS, type WalletSortOption } from '@ledova/shared';
import { Choice, Disclosure } from '../Ledger';
import { useThemedStyles } from '../../contexts';

export function WalletSort({
  open,
  sort,
  onToggle,
  onSort,
}: {
  open: boolean;
  sort: WalletSortOption;
  onToggle: () => void;
  onSort: (sort: WalletSortOption) => void;
}) {
  const toggle = useRef<View>(null);
  const styles = useThemedStyles((theme) => ({
    sort: { borderBottomWidth: 1, borderBottomColor: theme.colors.border.subtle },
    summary: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      justifyContent: 'space-between' as const,
      columnGap: theme.spacing.md,
      rowGap: theme.spacing.xs,
    },
    label: { fontFamily: theme.fontFamily.medium, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
    applied: {
      flexShrink: 1,
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.text.muted,
    },
    orders: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: theme.spacing.sm },
  }));
  const applied = WALLET_SORTS.find((option) => option.id === sort) ?? WALLET_SORTS[0];

  return (
    <View style={styles.sort}>
      <Disclosure
        ref={toggle}
        open={open}
        onToggle={onToggle}
        summary={
          <View style={styles.summary}>
            <Text style={styles.label}>Sort</Text>
            <Text style={styles.applied}>{applied.label}</Text>
          </View>
        }
      >
        <View style={styles.orders}>
          {WALLET_SORTS.map((option) => (
            <Choice
              key={option.id}
              label={option.label}
              selected={option.id === sort}
              onPress={() => {
                onSort(option.id);
                if (toggle.current) AccessibilityInfo.sendAccessibilityEvent(toggle.current, 'focus');
              }}
            />
          ))}
        </View>
      </Disclosure>
    </View>
  );
}

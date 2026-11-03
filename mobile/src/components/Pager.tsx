import { Text, View } from 'react-native';
import { PAGE_SIZE, formatShareCount } from '@ledova/shared';
import { useThemedStyles } from '../contexts';
import { useCompanyStyles } from '../hooks/useCompanyStyles';
import { Action } from './Ledger';

export function Pager({
  label,
  page,
  count,
  noun: [one, many],
  onPage,
}: {
  label: string;
  page: number;
  count: number;
  noun: readonly [string, string];
  onPage: (page: number) => void;
}) {
  const styles = useCompanyStyles();
  const look = useThemedStyles((theme) => ({
    pager: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      gap: 12,
    },
    pages: {
      marginLeft: 'auto' as const,
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.sm,
    },
  }));
  if (count === 0) return null;
  const pages = Math.ceil(count / PAGE_SIZE);
  const shown = Math.min(page, pages);
  const first = (shown - 1) * PAGE_SIZE + 1;
  const last = Math.min(shown * PAGE_SIZE, count);
  const total = `${formatShareCount(String(count))} ${count === 1 ? one : many}`;
  return (
    <View accessibilityLabel={label} style={look.pager}>
      <Text style={styles.muted}>
        {formatShareCount(String(first))}–{formatShareCount(String(last))} of {total}
      </Text>
      {pages > 1 && (
        <View style={look.pages}>
          <Action
            label="Previous"
            accessibilityLabel={`Previous (${label})`}
            disabled={shown === 1}
            onPress={() => onPage(shown - 1)}
          />
          <Text style={styles.muted}>
            Page {formatShareCount(String(shown))} of {formatShareCount(String(pages))}
          </Text>
          <Action
            label="Next"
            accessibilityLabel={`Next (${label})`}
            disabled={shown === pages}
            onPress={() => onPage(shown + 1)}
          />
        </View>
      )}
    </View>
  );
}

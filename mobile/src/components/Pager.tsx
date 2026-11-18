import { useContext, type RefObject } from 'react';
import { Text, View } from 'react-native';
import { formatShareCount, pageOf } from '@ledova/shared';
import { useThemedStyles } from '../contexts';
import { useCompanyStyles } from '../hooks/useCompanyStyles';
import { Action } from './Ledger';
import { PageScroll } from './Page';

export function Pager({
  label,
  page,
  count,
  noun: [one, many],
  onPage,
  top,
}: {
  label: string;
  page: number;
  count: number;
  noun: readonly [string, string];
  onPage: (page: number) => void;
  top?: RefObject<View | null>;
}) {
  const reveal = useContext(PageScroll);
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
  const { pages, page: shown, first, last } = pageOf(count, page);
  const total = `${formatShareCount(String(count))} ${count === 1 ? one : many}`;
  const go = (next: number) => {
    onPage(next);
    requestAnimationFrame(() => reveal(top?.current ?? null));
  };
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
            onPress={() => go(shown - 1)}
          />
          <Text style={styles.muted}>
            Page {formatShareCount(String(shown))} of {formatShareCount(String(pages))}
          </Text>
          <Action
            label="Next"
            accessibilityLabel={`Next (${label})`}
            disabled={shown === pages}
            onPress={() => go(shown + 1)}
          />
        </View>
      )}
    </View>
  );
}

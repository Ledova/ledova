import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { CoinsIcon } from 'phosphor-react-native';
import { PUBLICATION_COPY, formatDate, formatShareCount, useDividends } from '@ledova/shared';
import type { Publication } from '@ledova/shared';
import { GradientBackground } from '../../components/GradientBackground';
import { Panel } from '../../components/panel';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { Distribution } from '../publications/Distribution';

export function DividendsScreen() {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    container: { flex: 1 },
    content: { flex: 1, paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.md },
    centred: { alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: theme.spacing.xl },
    muted: { fontSize: theme.fontSize.sm, color: theme.colors.text.muted, marginTop: theme.spacing.sm },
    emptyTitle: {
      fontSize: theme.fontSize.lg,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.text.primary,
      marginTop: theme.spacing.sm,
      textAlign: 'center' as const,
    },
    emptyBody: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.muted,
      marginTop: theme.spacing.xs,
      textAlign: 'center' as const,
    },
    row: {
      paddingVertical: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border.subtle,
    },
    title: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.semibold, color: theme.colors.text.primary },
    detail: { fontSize: theme.fontSize.xs, color: theme.colors.text.muted, marginTop: 2 },
    holding: { fontSize: theme.fontSize.sm, color: theme.colors.text.primary, marginTop: theme.spacing.xs },
    button: {
      alignSelf: 'flex-start' as const,
      marginTop: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
      borderRadius: theme.borderRadius.sm,
      backgroundColor: theme.colors.interactive.active,
    },
    buttonLabel: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.text.primary,
    },
    apart: { fontSize: theme.fontSize.xs, color: theme.colors.text.muted, marginBottom: theme.spacing.sm },
  }));

  const { dividends, isLoading, listFailed, retry, hasMore, isLoadingMore, loadMore } = useDividends();

  const renderRow = (dividend: Publication) => (
    <View key={dividend.uuid} style={styles.row}>
      <Text style={styles.title}>{dividend.title}</Text>
      <Text style={styles.detail}>
        {dividend.companyName} · {dividend.tokenName} ({dividend.tokenSymbol})
      </Text>
      <Text style={styles.detail}>
        {PUBLICATION_COPY.RECORD_DATE_LABEL} {formatDate(dividend.recordDate)}
      </Text>
      {dividend.shares !== null && dividend.shares !== undefined && (
        <Text style={styles.holding}>
          {formatShareCount(dividend.shares)} · {PUBLICATION_COPY.HOLDING_LABEL}
        </Text>
      )}
      <Distribution publication={dividend} />
    </View>
  );

  return (
    <GradientBackground>
      <View style={styles.container}>
        <View style={styles.content}>
          <Panel
            title={PUBLICATION_COPY.DIVIDENDS_TITLE}
            icon={<CoinsIcon size={theme.icon.sizes.md} color={theme.colors.text.muted} />}
            fullHeight={true}
          >
            <Text style={styles.apart}>{PUBLICATION_COPY.DIVIDENDS_APART}</Text>
            {isLoading ? (
              <View style={styles.centred}>
                <ActivityIndicator size="large" color={theme.colors.interactive.active} />
                <Text style={styles.muted}>Loading...</Text>
              </View>
            ) : listFailed ? (
              <View style={styles.centred} accessibilityRole="alert">
                <Text style={styles.emptyTitle}>{PUBLICATION_COPY.DIVIDENDS_LIST_FAILED}</Text>
                <TouchableOpacity style={styles.button} onPress={retry} accessibilityRole="button">
                  <Text style={styles.buttonLabel}>{PUBLICATION_COPY.RETRY}</Text>
                </TouchableOpacity>
              </View>
            ) : dividends.length === 0 ? (
              <View style={styles.centred}>
                <CoinsIcon size={theme.icon.sizes.xl} color={theme.colors.text.subtle} weight="duotone" />
                <Text style={styles.emptyTitle}>{PUBLICATION_COPY.DIVIDENDS_EMPTY_TITLE}</Text>
                <Text style={styles.emptyBody}>{PUBLICATION_COPY.DIVIDENDS_EMPTY_BODY}</Text>
              </View>
            ) : (
              <ScrollView>
                {dividends.map(renderRow)}
                {hasMore && (
                  <TouchableOpacity
                    style={styles.button}
                    onPress={loadMore}
                    disabled={isLoadingMore}
                    accessibilityRole="button"
                  >
                    <Text style={styles.buttonLabel}>
                      {isLoadingMore ? PUBLICATION_COPY.LOADING_MORE : PUBLICATION_COPY.DIVIDENDS_LOAD_MORE}
                    </Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}
          </Panel>
        </View>
      </View>
    </GradientBackground>
  );
}

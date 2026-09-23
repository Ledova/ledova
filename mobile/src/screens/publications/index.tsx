import React from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { ArrowSquareOutIcon, EnvelopeSimpleIcon, NewspaperIcon } from 'phosphor-react-native';
import { PUBLICATION_COPY, PUBLICATION_KIND_LABELS, formatDate } from '@ledova/shared';
import type { Publication } from '@ledova/shared';
import { GradientBackground } from '../../components/GradientBackground';
import { Panel } from '../../components/panel';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { usePublications } from './usePublications';

export function PublicationsScreen() {
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
    kind: { fontSize: theme.fontSize.xs, color: theme.colors.text.muted, textTransform: 'uppercase' as const },
    title: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.text.primary,
      marginTop: 2,
    },
    detail: { fontSize: theme.fontSize.xs, color: theme.colors.text.muted, marginTop: 2 },
    holding: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.primary,
      marginTop: theme.spacing.xs,
    },
    openButton: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      alignSelf: 'flex-start' as const,
      gap: theme.spacing.xs,
      marginTop: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
      borderRadius: theme.borderRadius.sm,
      backgroundColor: theme.colors.interactive.active,
    },
    openLabel: { fontSize: theme.fontSize.sm, fontWeight: theme.fontWeight.semibold, color: theme.colors.text.primary },
    error: { fontSize: theme.fontSize.sm, color: theme.colors.status.error.text, marginBottom: theme.spacing.sm },
    help: { fontSize: theme.fontSize.xs, color: theme.colors.text.muted, marginTop: theme.spacing.md },
  }));

  const { publications, isLoading, listFailed, retry, hasMore, isLoadingMore, loadMore, open, openingUuid, openError } =
    usePublications();

  const renderRow = (publication: Publication) => (
    <View key={publication.uuid} style={styles.row}>
      <Text style={styles.kind}>{PUBLICATION_KIND_LABELS[publication.kind]}</Text>
      <Text style={styles.title}>{publication.title}</Text>
      <Text style={styles.detail}>
        {publication.companyName} · {publication.tokenName} ({publication.tokenSymbol})
      </Text>
      <Text style={styles.detail}>
        {PUBLICATION_COPY.RECORD_DATE_LABEL} {formatDate(publication.recordDate)}
      </Text>
      {publication.shares !== null && publication.shares !== undefined && (
        <Text style={styles.holding}>
          {Number(publication.shares).toLocaleString()} · {PUBLICATION_COPY.HOLDING_LABEL}
        </Text>
      )}
      <TouchableOpacity
        style={styles.openButton}
        onPress={() => {
          void open(publication.uuid);
        }}
        disabled={openingUuid !== undefined}
        accessibilityRole="button"
        accessibilityLabel={`${PUBLICATION_COPY.OPEN}: ${publication.title}`}
      >
        <ArrowSquareOutIcon size={theme.icon.sizes.sm} color={theme.colors.text.primary} />
        <Text style={styles.openLabel}>
          {openingUuid === publication.uuid ? PUBLICATION_COPY.OPENING : PUBLICATION_COPY.OPEN}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <GradientBackground>
      <View style={styles.container}>
        <View style={styles.content}>
          <Panel
            title={PUBLICATION_COPY.LIST_TITLE}
            icon={<NewspaperIcon size={theme.icon.sizes.md} color={theme.colors.text.muted} />}
            fullHeight={true}
          >
            {openError && <Text style={styles.error}>{openError}</Text>}
            {isLoading ? (
              <View style={styles.centred}>
                <ActivityIndicator size="large" color={theme.colors.interactive.active} />
                <Text style={styles.muted}>Loading...</Text>
              </View>
            ) : listFailed ? (
              <View style={styles.centred} accessibilityRole="alert">
                <Text style={styles.emptyTitle}>{PUBLICATION_COPY.LIST_FAILED}</Text>
                <TouchableOpacity style={styles.openButton} onPress={retry} accessibilityRole="button">
                  <Text style={styles.openLabel}>{PUBLICATION_COPY.RETRY}</Text>
                </TouchableOpacity>
              </View>
            ) : publications.length === 0 ? (
              <View style={styles.centred}>
                <EnvelopeSimpleIcon size={theme.icon.sizes.xl} color={theme.colors.text.subtle} weight="duotone" />
                <Text style={styles.emptyTitle}>{PUBLICATION_COPY.EMPTY_TITLE}</Text>
                <Text style={styles.emptyBody}>{PUBLICATION_COPY.EMPTY_BODY}</Text>
              </View>
            ) : (
              <ScrollView>
                {publications.map(renderRow)}
                {hasMore && (
                  <TouchableOpacity
                    style={styles.openButton}
                    onPress={loadMore}
                    disabled={isLoadingMore}
                    accessibilityRole="button"
                  >
                    <Text style={styles.openLabel}>
                      {isLoadingMore ? PUBLICATION_COPY.LOADING_MORE : PUBLICATION_COPY.LOAD_MORE}
                    </Text>
                  </TouchableOpacity>
                )}
                <Text style={styles.help}>{PUBLICATION_COPY.FROZEN_HELP}</Text>
              </ScrollView>
            )}
          </Panel>
        </View>
      </View>
    </GradientBackground>
  );
}

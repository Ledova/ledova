import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { PUBLICATION_COPY, PUBLICATION_KIND_LABELS, formatDate, formatShareCount } from '@ledova/shared';
import type { Publication } from '@ledova/shared';
import { GradientBackground } from '../../components/GradientBackground';
import { Action, Row, Section } from '../../components/Ledger';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { Distribution } from './Distribution';
import { Resolution } from './Resolution';
import { usePublications } from './usePublications';

export function PublicationsScreen() {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 36, gap: 28 },
    title: { fontFamily: theme.fontFamily.display, fontSize: 40, color: theme.colors.text.primary },
    message: { fontFamily: theme.fontFamily.regular, fontSize: 15, lineHeight: 23, color: theme.colors.text.muted },
    kind: {
      fontFamily: theme.fontFamily.medium,
      fontSize: 12,
      color: theme.colors.text.muted,
      textTransform: 'uppercase' as const,
    },
    company: { fontFamily: theme.fontFamily.regular, fontSize: 16, color: theme.colors.text.primary },
    details: { gap: 4 },
    holding: { fontFamily: theme.fontFamily.medium, fontSize: 18, color: theme.colors.text.primary },
    error: {
      fontFamily: theme.fontFamily.regular,
      fontSize: 15,
      lineHeight: 23,
      color: theme.colors.status.error.text,
    },
    help: { fontFamily: theme.fontFamily.regular, fontSize: 13, lineHeight: 20, color: theme.colors.text.muted },
    state: { gap: 14, paddingVertical: 12 },
  }));
  const {
    publications,
    isLoading,
    listFailed,
    moreFailed,
    isRefreshing,
    retry,
    hasMore,
    isLoadingMore,
    loadMore,
    open,
    openingUuid,
    openError,
    cast,
    castingUuid,
    castError,
  } = usePublications();

  const renderRow = (publication: Publication) => (
    <Section key={publication.uuid} title={publication.title}>
      <View style={styles.details}>
        <Text style={styles.kind}>{PUBLICATION_KIND_LABELS[publication.kind]}</Text>
        <Text style={styles.company}>{publication.companyName}</Text>
        <Text style={styles.message}>
          {publication.tokenName} ({publication.tokenSymbol})
        </Text>
      </View>
      <Action
        label={openingUuid === publication.uuid ? PUBLICATION_COPY.OPENING : PUBLICATION_COPY.OPEN}
        accessibilityLabel={`${PUBLICATION_COPY.OPEN}: ${publication.title}`}
        onPress={() => void open(publication.uuid)}
        disabled={openingUuid !== undefined}
      />
      <Row label={PUBLICATION_COPY.RECORD_DATE_LABEL}>{formatDate(publication.recordDate)}</Row>
      {publication.shares !== null && publication.shares !== undefined && (
        <View style={styles.details}>
          <Text style={styles.message}>
            {publication.kind === 'resolution' ? PUBLICATION_COPY.VOTING_WEIGHT_LABEL : PUBLICATION_COPY.HOLDING_LABEL}
          </Text>
          <Text style={styles.holding}>{formatShareCount(publication.shares)}</Text>
        </View>
      )}
      <Resolution
        publication={publication}
        onCast={(uuid, choice) => void cast(uuid, choice)}
        isCasting={castingUuid === publication.uuid}
        castError={castError?.uuid === publication.uuid ? castError.message : undefined}
      />
      <Distribution publication={publication} />
    </Section>
  );

  return (
    <GradientBackground>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing && !isLoading && !isLoadingMore}
            onRefresh={retry}
            tintColor={theme.colors.brand.default}
          />
        }
      >
        <Text accessibilityRole="header" style={styles.title}>
          Notices
        </Text>
        {openError && (
          <Text accessibilityRole="alert" style={styles.error}>
            {openError}
          </Text>
        )}
        {isLoading ? (
          <View style={styles.state}>
            <ActivityIndicator color={theme.colors.brand.default} />
            <Text style={styles.message}>Loading publications…</Text>
          </View>
        ) : listFailed ? (
          <View style={styles.state}>
            <Text accessibilityRole="alert" style={styles.message}>
              {publications.length
                ? 'Your notices could not be refreshed. Try again before continuing.'
                : PUBLICATION_COPY.LIST_FAILED}
            </Text>
            <Action label={PUBLICATION_COPY.RETRY} onPress={retry} disabled={isRefreshing} />
          </View>
        ) : (
          <>
            {publications.length === 0 && !hasMore && !moreFailed ? (
              <Section title="Your notices">
                <Text style={styles.message}>{PUBLICATION_COPY.EMPTY}</Text>
              </Section>
            ) : (
              publications.map(renderRow)
            )}
            {moreFailed ? (
              <View style={styles.state}>
                <Text accessibilityRole="alert" style={styles.message}>
                  Earlier notices could not be loaded. The list is incomplete.
                </Text>
                <Action label="Try earlier notices again" onPress={loadMore} disabled={isLoadingMore} />
              </View>
            ) : (
              hasMore && (
                <Action
                  label={isLoadingMore ? PUBLICATION_COPY.LOADING_MORE : PUBLICATION_COPY.LOAD_MORE}
                  onPress={loadMore}
                  disabled={isLoadingMore}
                />
              )
            )}
            {publications.length > 0 && <Text style={styles.help}>{PUBLICATION_COPY.FROZEN_HELP}</Text>}
          </>
        )}
      </ScrollView>
    </GradientBackground>
  );
}

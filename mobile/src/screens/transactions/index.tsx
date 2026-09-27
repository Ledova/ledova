import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { GradientBackground } from '../../components/GradientBackground';
import { Action, Section } from '../../components/Ledger';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { useTransactions } from './useTransactions';
import { TransactionFiltersModal } from './components/filters/TransactionFiltersModal';
import { TransactionListItem } from './components/TransactionListItem';
import { TransactionDetailModal } from './components/TransactionDetailModal';

export function TransactionsScreen() {
  const navigation = useNavigation();
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 36, gap: 24 },
    title: { fontFamily: theme.fontFamily.display, fontSize: 40, color: theme.colors.text.primary },
    message: { fontFamily: theme.fontFamily.regular, fontSize: 15, lineHeight: 23, color: theme.colors.text.muted },
    actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10 },
    state: { gap: 14, paddingVertical: 12 },
  }));
  const {
    transactions,
    wallets,
    walletsLoading,
    walletsFailed,
    walletsRefreshing,
    retryWallets,
    isLoading,
    hasError,
    moreFailed,
    isRefreshing,
    retry,
    isLoadingMore,
    filters,
    hasActiveFilters,
    totalCount,
    hasNextPage,
    applyFilters,
    updateFilters,
    clearFilters,
    loadMore,
  } = useTransactions();
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const selected = hasError ? null : (transactions.find((transaction) => transaction.uuid === selectedUuid) ?? null);
  const closeFilters = () => {
    setShowFilters(false);
    setSelectedUuid(null);
  };
  const clear = () => {
    clearFilters();
    closeFilters();
  };
  return (
    <GradientBackground>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing && !isLoading && !isLoadingMore}
            onRefresh={() => void retry()}
            tintColor={theme.colors.brand.default}
          />
        }
      >
        <Text accessibilityRole="header" style={styles.title}>
          Activity
        </Text>
        <Text style={styles.message}>
          Recorded transfers for your wallets. Select an entry for its status and details.
        </Text>
        <View style={styles.actions}>
          <Action label="Open Notices" onPress={() => navigation.navigate('Publications' as never)} />
          <Action label={hasActiveFilters ? 'Filter (active)' : 'Filter'} onPress={() => setShowFilters(true)} />
        </View>
        {isLoading ? (
          <View style={styles.state}>
            <ActivityIndicator color={theme.colors.brand.default} />
            <Text style={styles.message}>Loading activity…</Text>
          </View>
        ) : hasError ? (
          <View style={styles.state}>
            <Text accessibilityRole="alert" style={styles.message}>
              Your activity could not be loaded. Try again before continuing.
            </Text>
            <Action label="Try again" onPress={() => void retry()} disabled={isRefreshing} />
          </View>
        ) : (
          <>
            {transactions.length === 0 && !hasNextPage && !moreFailed ? (
              <Section title={hasActiveFilters ? 'No matching activity' : 'No activity yet'}>
                <Text style={styles.message}>
                  {hasActiveFilters
                    ? 'Adjust or clear the filters to view more activity.'
                    : 'Recorded transfers will appear here, including those awaiting confirmation.'}
                </Text>
                {hasActiveFilters && <Action label="Clear filters" onPress={clear} />}
              </Section>
            ) : (
              <View>
                {transactions.map((transaction) => (
                  <TransactionListItem
                    key={transaction.uuid}
                    transaction={transaction}
                    onPress={(row) => setSelectedUuid(row.uuid)}
                  />
                ))}
              </View>
            )}
            {moreFailed ? (
              <View style={styles.state}>
                <Text accessibilityRole="alert" style={styles.message}>
                  More activity could not be loaded. The list is incomplete.
                </Text>
                <Action label="Try more activity again" onPress={() => void loadMore()} disabled={isRefreshing} />
              </View>
            ) : (
              hasNextPage && (
                <Action
                  label={isLoadingMore ? 'Loading activity…' : 'Load more activity'}
                  onPress={() => void loadMore()}
                  disabled={isRefreshing}
                />
              )
            )}
            {transactions.length > 0 && (
              <Text style={styles.message}>
                {transactions.length} of {totalCount} records shown
              </Text>
            )}
          </>
        )}
      </ScrollView>
      <TransactionFiltersModal
        isOpen={showFilters}
        filters={filters}
        wallets={wallets}
        walletsLoading={walletsLoading}
        walletsFailed={walletsFailed}
        walletsRefreshing={walletsRefreshing}
        onRetryWallets={() => void retryWallets()}
        onClose={() => setShowFilters(false)}
        onUpdateFilters={updateFilters}
        onApplyFilters={() => {
          applyFilters();
          closeFilters();
        }}
        onClearFilters={clear}
      />
      <TransactionDetailModal
        visible={selected !== null}
        transaction={selected}
        onClose={() => setSelectedUuid(null)}
      />
    </GradientBackground>
  );
}

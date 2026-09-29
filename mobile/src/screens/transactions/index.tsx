import { useState } from 'react';
import { ActivityIndicator, RefreshControl, Text, View } from 'react-native';
import { Action, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { useTransactions } from '@ledova/shared';
import { TransactionFiltersModal } from './components/filters/TransactionFiltersModal';
import { TransactionListItem } from './components/TransactionListItem';
import { TransactionDetailModal } from './components/TransactionDetailModal';

export function TransactionsScreen() {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    message: { fontFamily: theme.fontFamily.regular, fontSize: 15, lineHeight: 23, color: theme.colors.text.muted },
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
    <>
      <Page
        title="Activity"
        lede="Select an entry for its status and details."
        actions={
          <Action label={hasActiveFilters ? 'Filter (active)' : 'Filter'} onPress={() => setShowFilters(true)} />
        }
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing && !isLoading && !isLoadingMore}
            onRefresh={() => void retry()}
            tintColor={theme.colors.brand.default}
          />
        }
      >
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
          <Section title="Transfers">
            {transactions.length === 0 && !hasNextPage && !moreFailed ? (
              <>
                <Text style={styles.message}>{hasActiveFilters ? 'No matching activity.' : 'No activity yet.'}</Text>
                {hasActiveFilters && <Action label="Clear filters" onPress={clear} />}
              </>
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
          </Section>
        )}
      </Page>
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
    </>
  );
}

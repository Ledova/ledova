import { useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, RefreshControl, Text, View } from 'react-native';
import { useOpenRows } from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { useTransactions } from './useTransactions';
import { TransactionFilter } from './components/filters/TransactionFilter';
import { TransactionListItem } from './components/TransactionListItem';

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
    appliedFilters,
    hasActiveFilters,
    totalCount,
    hasNextPage,
    applyFilters,
    updateFilters,
    clearFilters,
    loadMore,
  } = useTransactions();
  const entries = useOpenRows();
  const [filterOpen, setFilterOpen] = useState(false);
  const filterToggle = useRef<View>(null);
  const settleFilters = () => {
    setFilterOpen(false);
    entries.closeAll();
    if (filterToggle.current) AccessibilityInfo.sendAccessibilityEvent(filterToggle.current, 'focus');
  };
  const apply = () => {
    applyFilters();
    settleFilters();
  };
  const clear = () => {
    clearFilters();
    settleFilters();
  };
  return (
    <Page
      title="Activity"
      lede="Select an entry for its status and details."
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing && !isLoading && !isLoadingMore}
          onRefresh={() => void retry()}
          tintColor={theme.colors.brand.default}
        />
      }
    >
      <Section title="Transfers">
        <TransactionFilter
          ref={filterToggle}
          open={filterOpen}
          onToggle={() => setFilterOpen((open) => !open)}
          applied={appliedFilters}
          filters={filters}
          wallets={wallets}
          walletsLoading={walletsLoading}
          walletsFailed={walletsFailed}
          walletsRefreshing={walletsRefreshing}
          onRetryWallets={() => void retryWallets()}
          onUpdateFilters={updateFilters}
          onApplyFilters={apply}
          onClearFilters={clear}
        />
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
                    open={entries.isOpen(transaction.uuid)}
                    onToggle={(row) => entries.toggle(row.uuid)}
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
      </Section>
    </Page>
  );
}

import { useRef, useState } from 'react';
import { useOpenRows, useTransactions, type TransactionFilters } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Section } from '@components/Ledger';
import { LoadMore } from '@components/List';
import { TransactionFilter } from './TransactionFilter';
import { TransactionListItem } from './TransactionListItem';

const TransactionsPage = () => {
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
  const filterToggle = useRef<HTMLButtonElement>(null);
  const handleFilterChange = (field: keyof TransactionFilters, value: string) =>
    updateFilters({ ...filters, [field]: value || undefined });
  const settleFilters = () => {
    setFilterOpen(false);
    entries.closeAll();
    filterToggle.current?.focus();
  };
  const handleApplyFilters = () => {
    applyFilters();
    settleFilters();
  };
  const handleClearFilters = () => {
    clearFilters();
    settleFilters();
  };

  return (
    <Page narrow>
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
          onFilterChange={handleFilterChange}
          onApply={handleApplyFilters}
          onClear={handleClearFilters}
        />
        {isLoading ? (
          <p role="status" className="py-3 text-sm text-text-muted">
            Loading activity…
          </p>
        ) : hasError ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-3">
            <p className="text-sm text-text-primary">Your activity could not be loaded. Try again before continuing.</p>
            <PageAction label="Try again" onClick={() => void retry()} disabled={isRefreshing} />
          </div>
        ) : (
          <>
            {transactions.length === 0 && !hasNextPage && !moreFailed ? (
              <>
                <p className="py-3 text-sm text-text-muted">
                  {hasActiveFilters ? 'No matching activity.' : 'No activity yet.'}
                </p>
                {hasActiveFilters && <PageAction label="Clear filters" onClick={handleClearFilters} />}
              </>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {transactions.map((transaction) => (
                  <li key={transaction.uuid}>
                    <TransactionListItem
                      transaction={transaction}
                      open={entries.isOpen(transaction.uuid)}
                      onToggle={(entry) => entries.toggle(entry.uuid)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <LoadMore
              noun={['activity', 'activity']}
              hasMore={hasNextPage}
              failed={moreFailed}
              loading={isLoadingMore}
              disabled={isRefreshing}
              onLoad={() => void loadMore()}
            />
            {transactions.length > 0 && (
              <p className="text-xs text-text-muted">
                {transactions.length} of {totalCount} records shown
              </p>
            )}
          </>
        )}
      </Section>
    </Page>
  );
};

export default TransactionsPage;

import { useRef, useState } from 'react';
import { useOpenRows } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Section } from '@components/Ledger';
import { useTransactions, type TransactionFilters } from './useTransactions';
import { TransactionFilter } from './components/TransactionFilter';
import { TransactionListItem } from './components/TransactionListItem';

export const TransactionsPage = () => {
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
    <Page lede="Select an entry for its status and details.">
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
            {moreFailed ? (
              <div role="alert" className="flex flex-col items-start gap-3 py-3">
                <p className="text-sm text-text-primary">More activity could not be loaded. The list is incomplete.</p>
                <PageAction label="Try more activity again" onClick={() => void loadMore()} disabled={isLoadingMore} />
              </div>
            ) : (
              hasNextPage && (
                <PageAction
                  label={isLoadingMore ? 'Loading activity…' : 'Load more activity'}
                  onClick={() => void loadMore()}
                  disabled={isLoadingMore}
                />
              )
            )}
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

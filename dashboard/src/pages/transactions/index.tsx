import { useState } from 'react';
import { FunnelIcon } from '@phosphor-icons/react';
import { getBlockExplorerTxUrl } from '@ledova/shared';
import type { Transaction } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Section } from '@components/Ledger';
import { useTransactions, type TransactionFilters } from './useTransactions';
import { TransactionFilterModal } from './components/TransactionFilterModal';
import { TransactionListItem } from './components/TransactionListItem';
import { TransactionDetailModal } from './components/TransactionDetailModal';

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
    hasActiveFilters,
    totalCount,
    hasNextPage,
    applyFilters,
    updateFilters,
    clearFilters,
    loadMore,
  } = useTransactions();
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const selectedTransaction = hasError
    ? null
    : (transactions.find((transaction) => transaction.uuid === selectedUuid) ?? null);
  const handleTransactionClick = (transaction: Transaction) => setSelectedUuid(transaction.uuid);
  const handleFilterChange = (field: keyof TransactionFilters, value: string) =>
    updateFilters({ ...filters, [field]: value || undefined });
  const handleApplyFilters = () => {
    applyFilters();
    setShowFiltersModal(false);
    setSelectedUuid(null);
  };
  const handleClearFilters = () => {
    clearFilters();
    setShowFiltersModal(false);
    setSelectedUuid(null);
  };
  const handleViewOnExplorer = () => {
    if (!selectedTransaction?.txHash) return;
    const url = getBlockExplorerTxUrl(selectedTransaction.chain, selectedTransaction.txHash);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Page
      actions={
        <PageAction
          icon={<FunnelIcon size={16} />}
          label="Filter"
          onClick={() => setShowFiltersModal(true)}
          active={hasActiveFilters}
        />
      }
    >
      <p className="text-sm text-text-muted">
        Recorded transfers for your wallets. Select an entry for its status and details.
      </p>
      {isLoading ? (
        <p role="status" className="py-6 text-sm text-text-muted">
          Loading activity…
        </p>
      ) : hasError ? (
        <div role="alert" className="flex flex-col items-start gap-3 py-6">
          <p className="text-sm text-text-primary">Your activity could not be loaded. Try again before continuing.</p>
          <PageAction label="Try again" onClick={() => void retry()} disabled={isRefreshing} />
        </div>
      ) : (
        <Section title="Transfers">
          {transactions.length === 0 && !hasNextPage && !moreFailed ? (
            <>
              <p className="py-3 text-sm text-text-muted">
                {hasActiveFilters ? 'No matching activity.' : 'No activity yet.'}
              </p>
              {hasActiveFilters && <PageAction label="Clear filters" onClick={handleClearFilters} />}
            </>
          ) : (
            <div className="divide-y divide-border-subtle">
              {transactions.map((transaction) => (
                <TransactionListItem
                  key={transaction.uuid}
                  transaction={transaction}
                  onClick={handleTransactionClick}
                />
              ))}
            </div>
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
        </Section>
      )}
      <TransactionFilterModal
        isOpen={showFiltersModal}
        filters={filters}
        wallets={wallets}
        walletsLoading={walletsLoading}
        walletsFailed={walletsFailed}
        walletsRefreshing={walletsRefreshing}
        onRetryWallets={() => void retryWallets()}
        onClose={() => setShowFiltersModal(false)}
        onFilterChange={handleFilterChange}
        onApply={handleApplyFilters}
        onClear={handleClearFilters}
      />
      <TransactionDetailModal
        isOpen={selectedTransaction !== null}
        transaction={selectedTransaction}
        onClose={() => setSelectedUuid(null)}
        onViewExplorer={handleViewOnExplorer}
      />
    </Page>
  );
};

export default TransactionsPage;

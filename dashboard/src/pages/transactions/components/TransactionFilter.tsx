import type { Ref } from 'react';
import { BLOCKCHAIN, formatDate } from '@ledova/shared';
import type { Wallet } from '@ledova/shared';
import { Disclosure } from '@components/Ledger';
import { PageAction } from '@components/Page';
import type { TransactionFilters } from '../useTransactions';

interface TransactionFilterProps {
  ref?: Ref<HTMLButtonElement>;
  open: boolean;
  onToggle: () => void;
  applied: TransactionFilters;
  filters: TransactionFilters;
  wallets: Wallet[];
  walletsLoading: boolean;
  walletsFailed: boolean;
  walletsRefreshing: boolean;
  onRetryWallets: () => void;
  onFilterChange: (field: keyof TransactionFilters, value: string) => void;
  onApply: () => void;
  onClear: () => void;
}

const FIELD_CLASS =
  'mt-1 block w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary ' +
  'placeholder:text-text-muted focus:border-brand-mid focus:outline-none focus:ring-1 focus:ring-brand-mid';
const directions = [
  { value: '', label: 'All' },
  { value: 'incoming', label: 'Incoming' },
  { value: 'outgoing', label: 'Outgoing' },
];
const networks = [
  { value: '', label: 'All' },
  { value: BLOCKCHAIN.ETHEREUM, label: 'Ethereum' },
  { value: BLOCKCHAIN.BITCOIN, label: 'Bitcoin' },
  { value: BLOCKCHAIN.BASE, label: 'Base' },
];

function appliedSummary(applied: TransactionFilters, wallets: Wallet[]) {
  const parts: string[] = [];
  const direction = directions.find((option) => option.value && option.value === applied.direction);
  if (direction) parts.push(direction.label);
  const network = networks.find((option) => option.value && option.value === applied.chain);
  if (network) parts.push(network.label);
  if (applied.wallet) {
    const wallet = wallets.find((candidate) => candidate.uuid === applied.wallet);
    parts.push(wallet ? wallet.name || wallet.address : 'Selected wallet');
  }
  if (applied.start_date && applied.end_date) {
    parts.push(`${formatDate(applied.start_date)} to ${formatDate(applied.end_date)}`);
  } else if (applied.start_date) {
    parts.push(`From ${formatDate(applied.start_date)}`);
  } else if (applied.end_date) {
    parts.push(`Through ${formatDate(applied.end_date)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'All transfers';
}

export function TransactionFilter({
  ref,
  open,
  onToggle,
  applied,
  filters,
  wallets,
  walletsLoading,
  walletsFailed,
  walletsRefreshing,
  onRetryWallets,
  onFilterChange,
  onApply,
  onClear,
}: TransactionFilterProps) {
  const datesInvalid = Boolean(filters.start_date && filters.end_date && filters.start_date > filters.end_date);
  return (
    <div className="border-b border-border-subtle">
      <Disclosure
        ref={ref}
        region
        open={open}
        onToggle={onToggle}
        summary={
          <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sm font-medium text-text-primary">Filter</span>
            <span className="min-w-0 break-words text-sm text-text-muted">{appliedSummary(applied, wallets)}</span>
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <fieldset>
              <legend className="mb-1 text-sm text-text-muted">Direction</legend>
              <div className="flex flex-wrap gap-2">
                {directions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={(filters.direction ?? '') === option.value}
                    onClick={() => onFilterChange('direction', option.value)}
                    className="rounded-lg border border-border px-3 py-2 text-sm text-text-primary aria-pressed:border-brand-mid aria-pressed:text-brand-light"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="block text-sm text-text-muted">
              Network
              <select
                className={FIELD_CLASS}
                value={filters.chain ?? ''}
                onChange={(event) => onFilterChange('chain', event.target.value)}
              >
                {networks.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-2">
              <label className="block text-sm text-text-muted">
                Wallet
                <select
                  className={FIELD_CLASS}
                  value={filters.wallet ?? ''}
                  onChange={(event) => onFilterChange('wallet', event.target.value)}
                  disabled={walletsLoading || walletsFailed}
                >
                  <option value="">All wallets</option>
                  {filters.wallet && !wallets.some((wallet) => wallet.uuid === filters.wallet) && (
                    <option value={filters.wallet} disabled>
                      Selected wallet unavailable
                    </option>
                  )}
                  {wallets.map((wallet) => (
                    <option key={wallet.uuid} value={wallet.uuid}>
                      {wallet.name ? `${wallet.name} · ` : ''}
                      {wallet.address}
                    </option>
                  ))}
                </select>
              </label>
              {walletsLoading && (
                <p role="status" className="text-sm text-text-muted">
                  Loading wallets…
                </p>
              )}
              {walletsFailed && (
                <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-primary">
                  <p>Wallet filters could not be loaded. Your activity can still be viewed.</p>
                  <PageAction label="Try wallets again" onClick={onRetryWallets} disabled={walletsRefreshing} />
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm text-text-muted">
              From date
              <input
                type="date"
                className={FIELD_CLASS}
                value={filters.start_date ?? ''}
                onChange={(event) => onFilterChange('start_date', event.target.value)}
              />
            </label>
            <label className="block text-sm text-text-muted">
              Through date
              <input
                type="date"
                className={FIELD_CLASS}
                value={filters.end_date ?? ''}
                onChange={(event) => onFilterChange('end_date', event.target.value)}
              />
            </label>
          </div>
          <p className="text-xs text-text-muted">Dates include the whole selected days in your local time.</p>
          {datesInvalid && (
            <p role="alert" className="text-sm text-error-light">
              The through date must be on or after the from date.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <PageAction label="Clear" onClick={onClear} />
            <PageAction
              label="Apply"
              primary
              onClick={() => {
                if (!datesInvalid) onApply();
              }}
              disabled={datesInvalid}
            />
          </div>
        </div>
      </Disclosure>
    </div>
  );
}

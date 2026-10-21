import { Field, TextInput } from '@components/Field';
import { SelectField } from '@components/SelectField';
import { Choices } from '@components/Choices';
import type { Ref } from 'react';
import { BLOCKCHAIN, formatDate } from '@ledova/shared';
import type { TransactionFilters, Wallet } from '@ledova/shared';
import { Disclosure, LoadError, Loading } from '@components/Ledger';
import { PageAction } from '@components/Page';

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
            <Choices
              legend="Direction"
              options={directions.map((option) => [option.value, option.label] as const)}
              value={filters.direction ?? ''}
              onChange={(direction) => onFilterChange('direction', direction)}
            />
            <Choices
              legend="Network"
              options={networks.map((option) => [option.value, option.label] as const)}
              value={filters.chain ?? ''}
              onChange={(chain) => onFilterChange('chain', chain)}
            />
            <div className="flex flex-col gap-2">
              <SelectField
                label="Wallet"
                options={[
                  { value: '', label: 'All wallets' },
                  ...(filters.wallet && !wallets.some((wallet) => wallet.uuid === filters.wallet)
                    ? [{ value: filters.wallet, label: 'Selected wallet unavailable', disabled: true }]
                    : []),
                  ...wallets.map((wallet) => ({
                    value: wallet.uuid,
                    label: `${wallet.name ? `${wallet.name} · ` : ''}${wallet.address}`,
                  })),
                ]}
                value={filters.wallet ?? ''}
                disabled={walletsLoading || walletsFailed}
                onChange={(wallet) => onFilterChange('wallet', wallet)}
              />
              {walletsLoading && <Loading>Loading your wallets…</Loading>}
              {walletsFailed && (
                <LoadError retry={onRetryWallets} busy={walletsRefreshing}>
                  Wallet filters could not be loaded. Your activity can still be viewed.
                </LoadError>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="From date">
              <TextInput
                type="date"
                value={filters.start_date ?? ''}
                onChange={(event) => onFilterChange('start_date', event.target.value)}
              />
            </Field>
            <Field label="Through date">
              <TextInput
                type="date"
                value={filters.end_date ?? ''}
                onChange={(event) => onFilterChange('end_date', event.target.value)}
              />
            </Field>
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

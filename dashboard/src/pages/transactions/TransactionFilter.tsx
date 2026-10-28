import { Field, TextInput } from '@components/Field';
import { SelectField } from '@components/SelectField';
import { FilterPopover } from '@components/FilterPopover';
import type { Ref } from 'react';
import { BLOCKCHAIN } from '@ledova/shared';
import type { TransactionFilters, Wallet } from '@ledova/shared';
import { LoadError, Loading } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';

interface TransactionFilterProps {
  ref?: Ref<HTMLButtonElement>;
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

export function TransactionFilter({
  ref,
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
    <FilterPopover ref={ref} active={Object.values(applied).some((value) => value !== undefined)}>
      {(close) => (
        <>
          <SelectField
            label="Direction"
            options={directions}
            value={filters.direction ?? ''}
            onChange={(direction) => onFilterChange('direction', direction)}
          />
          <SelectField
            label="Network"
            options={networks}
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
          <p className="text-xs text-text-muted">Dates include the whole selected days in your local time.</p>
          {datesInvalid && (
            <p role="alert" className="text-sm text-error-light">
              The through date must be on or after the from date.
            </p>
          )}
          <FormActions>
            <PageAction
              label="Clear"
              onClick={() => {
                close();
                onClear();
              }}
            />
            <PageAction
              label="Apply"
              primary
              onClick={() => {
                if (!datesInvalid) {
                  close();
                  onApply();
                }
              }}
              disabled={datesInvalid}
            />
          </FormActions>
        </>
      )}
    </FilterPopover>
  );
}

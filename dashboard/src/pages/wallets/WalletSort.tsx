import { useRef } from 'react';
import { WALLET_SORTS, type WalletSortOption } from '@ledova/shared';
import { Disclosure } from '@components/Ledger';
import { PageAction } from '@components/Page';

interface WalletSortProps {
  open: boolean;
  sort: WalletSortOption;
  onToggle: () => void;
  onSort: (sort: WalletSortOption) => void;
}

export function WalletSort({ open, sort, onToggle, onSort }: WalletSortProps) {
  const toggle = useRef<HTMLButtonElement>(null);
  const applied = WALLET_SORTS.find((option) => option.id === sort) ?? WALLET_SORTS[0];

  return (
    <div className="border-b border-border-subtle">
      <Disclosure
        ref={toggle}
        open={open}
        onToggle={onToggle}
        summary={
          <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sm font-medium text-text-primary">Sort</span>
            <span className="min-w-0 break-words text-sm text-text-muted">{applied.label}</span>
          </span>
        }
      >
        <div className="flex flex-wrap gap-2">
          {WALLET_SORTS.map((option) => (
            <PageAction
              key={option.id}
              label={option.label}
              pressed={option.id === sort}
              onClick={() => {
                onSort(option.id);
                toggle.current?.focus();
              }}
            />
          ))}
        </div>
      </Disclosure>
    </div>
  );
}

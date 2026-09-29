import { useState } from 'react';
import {
  ListBulletsIcon,
  ShieldCheckIcon,
  SortAscendingIcon,
  TagIcon,
  CurrencyCircleDollarIcon,
  CoinsIcon,
  CheckIcon,
} from '@phosphor-icons/react';
import { DESIGN_TOKENS } from '@ledova/shared';
import { Modal } from '@components/Modal';
import type { WalletSortOption } from '../hooks/useWalletSort';

const ICON_SM = DESIGN_TOKENS.icon.sizes.sm;

interface WalletSortModalProps {
  isOpen: boolean;
  selectedSort: WalletSortOption;
  onClose: () => void;
  onApply: (sort: WalletSortOption) => void;
}

const sortOptions: Array<{ id: WalletSortOption; label: string; icon: React.ReactNode; description: string }> = [
  {
    id: 'default',
    label: 'Default',
    icon: <ListBulletsIcon size={ICON_SM} className="text-text-primary" />,
    description: 'Hardware wallets first',
  },
  {
    id: 'verified',
    label: 'Verified First',
    icon: <ShieldCheckIcon size={ICON_SM} className="text-success-light" />,
    description: 'Show verified wallets first',
  },
  {
    id: 'name',
    label: 'Alphabetical',
    icon: <SortAscendingIcon size={ICON_SM} className="text-text-primary" />,
    description: 'Sort by name (A-Z)',
  },
  {
    id: 'namedFirst',
    label: 'Named First',
    icon: <TagIcon size={ICON_SM} className="text-text-primary" />,
    description: 'Wallets with names before unnamed',
  },
  {
    id: 'highestValue',
    label: 'Highest Value',
    icon: <CurrencyCircleDollarIcon size={ICON_SM} className="text-text-primary" />,
    description: 'Sort by market value (highest first)',
  },
  {
    id: 'highestBalance',
    label: 'Most Coins',
    icon: <CoinsIcon size={ICON_SM} className="text-text-primary" />,
    description: 'Sort by native balance (highest first)',
  },
];

export function WalletSortModal({ isOpen, selectedSort, onClose, onApply }: WalletSortModalProps) {
  const [localSort, setLocalSort] = useState<WalletSortOption>(selectedSort);
  const [shownFor, setShownFor] = useState({ isOpen, selectedSort });

  if (shownFor.isOpen !== isOpen || shownFor.selectedSort !== selectedSort) {
    setShownFor({ isOpen, selectedSort });
    if (isOpen) setLocalSort(selectedSort);
  }

  const handleApply = () => {
    onApply(localSort);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Sort Wallets"
      showFooter
      cancelLabel="Close"
      confirmLabel="Apply"
      onConfirm={handleApply}
      size="sm"
    >
      <div className="divide-y divide-border-subtle">
        {sortOptions.map((option) => {
          const isSelected = localSort === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setLocalSort(option.id)}
              className="flex w-full items-center justify-between gap-3 py-2.5"
            >
              <div className="flex items-center gap-3">
                <span className="flex-shrink-0">{option.icon}</span>
                <div className="text-left">
                  <p className={`text-sm font-medium ${isSelected ? 'text-brand-light' : 'text-text-primary'}`}>
                    {option.label}
                  </p>
                  <p className="text-[11px] text-text-muted">{option.description}</p>
                </div>
              </div>
              {isSelected && <CheckIcon size={ICON_SM} className="text-brand-mid flex-shrink-0" weight="bold" />}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

import { ArrowsClockwiseIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { BLOCKCHAIN, DESIGN_TOKENS, getWallets } from '@ledova/shared';
import type { Wallet } from '@ledova/shared';
import { Modal } from '@components/Modal';
import { WalletChoice } from '@components/Wallet';
import apiClient from '@services/apiClient';

const ICON_LG = DESIGN_TOKENS.icon.sizes.lg;
const CHAINS = [
  { chain: BLOCKCHAIN.ETHEREUM, title: 'Ethereum' },
  { chain: BLOCKCHAIN.BITCOIN, title: 'Bitcoin' },
  { chain: BLOCKCHAIN.BASE, title: 'Base' },
];

interface WalletSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectWallet: (wallet: Wallet) => void;
}

export function WalletSelectionModal({ isOpen, onClose, onSelectWallet }: WalletSelectionModalProps) {
  const walletsQuery = useQuery({
    queryKey: ['wallets', { verification_status: 'VERIFIED', ordering: 'signing_preference' }],
    queryFn: () =>
      getWallets(apiClient, {
        verification_status: 'VERIFIED',
        ordering: 'signing_preference',
      }),
    enabled: isOpen,
  });

  const wallets = walletsQuery.data?.data.results || [];

  const renderContent = () => {
    if (walletsQuery.isLoading) {
      return (
        <div className="flex items-center justify-center py-8">
          <ArrowsClockwiseIcon size={ICON_LG} className="animate-spin text-text-muted" />
          <span className="ml-2 text-sm text-text-muted">Loading wallets...</span>
        </div>
      );
    }

    if (wallets.length === 0) {
      return (
        <div className="space-y-1">
          <p className="text-sm text-text-muted">No verified wallets found</p>
          <p className="text-xs text-text-subtle">Create and verify a wallet to send crypto</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {CHAINS.map(({ chain, title }) => {
          const chainWallets = wallets.filter((wallet) => wallet.chain === chain);
          if (chainWallets.length === 0) return null;
          return (
            <div key={chain}>
              <span className="text-xs font-medium uppercase tracking-wider text-text-muted">{title}</span>
              <ul className="divide-y divide-border-subtle">
                {chainWallets.map((wallet) => (
                  <li key={wallet.uuid}>
                    <WalletChoice wallet={wallet} onChoose={() => onSelectWallet(wallet)} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Select your wallet" showFooter showCancelButton onCancel={onClose}>
      {renderContent()}
    </Modal>
  );
}

import { getActiveChains } from '@ledova/shared';
import type { Wallet } from '@ledova/shared';
import { Modal } from '@components/Modal';
import { WalletChoice } from '@components/wallet';
import { useWalletSelection } from './useWalletSelection';
import { LoadError, Loading } from '@components/Ledger';

interface WalletSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectWallet: (wallet: Wallet) => void;
}

export function WalletSelectionModal({ isOpen, onClose, onSelectWallet }: WalletSelectionModalProps) {
  const { walletsQuery, wallets } = useWalletSelection(isOpen);

  const renderContent = () => {
    if (walletsQuery.isError) {
      return (
        <LoadError retry={() => walletsQuery.refetch()} busy={walletsQuery.isFetching}>
          Your wallets could not be loaded.
        </LoadError>
      );
    }

    if (walletsQuery.isPending) {
      return <Loading>Loading your wallets…</Loading>;
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
        {getActiveChains().map(({ code, name }) => {
          const chainWallets = wallets.filter((wallet) => wallet.chain === code);
          if (chainWallets.length === 0) return null;
          return (
            <div key={code}>
              <span className="text-xs font-medium uppercase tracking-wider text-text-muted">{name}</span>
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

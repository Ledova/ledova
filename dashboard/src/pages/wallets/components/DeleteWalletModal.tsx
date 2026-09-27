import type { ReactNode } from 'react';
import { formatWalletAddressShort } from '@ledova/shared';
import type { Wallet } from '@ledova/shared';
import { Modal } from '@components/Modal';

interface DeleteWalletModalProps {
  readBlocked?: boolean;
  notice?: ReactNode;
  error?: string | null;
  isDeleting?: boolean;
  isOpen: boolean;
  wallet: Wallet | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function DeleteWalletModal({
  isOpen,
  wallet,
  onConfirm,
  onClose,
  isDeleting,
  error,
  readBlocked,
  notice,
}: DeleteWalletModalProps) {
  if (!wallet) return null;

  const walletDisplayName = wallet.name || formatWalletAddressShort(wallet.address);

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isDeleting) onClose();
      }}
      title="Delete Wallet"
      showFooter
      confirmLabel="Delete"
      onConfirm={() => {
        if (!isDeleting && !readBlocked) onConfirm();
      }}
      confirmDisabled={readBlocked}
      confirmLoading={isDeleting}
    >
      <div className="text-center py-4">
        {notice}
        {error && (
          <p role="alert" className="mb-3 text-sm text-error-light">
            {error}
          </p>
        )}
        <p className="text-sm text-text-secondary mb-2">Are you sure you want to delete this wallet?</p>
        <p className="text-sm font-medium text-text-primary">{walletDisplayName}</p>
        <p className="text-xs text-text-muted mt-2">This action cannot be undone.</p>
      </div>
    </Modal>
  );
}

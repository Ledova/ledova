import { useState } from 'react';
import { WALLET_VERIFICATION_STATUS, getActiveChains, sortWallets, useWalletSort } from '@ledova/shared';
import type { Wallet as WalletType, DerivedAddress, HardwareWalletImport } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Section } from '@components/Ledger';
import { WalletItem } from '@components/Wallet';
import { useWallets } from './hooks/useWallets';
import { WalletActions } from './components/WalletActions';
import { WalletSort } from './components/WalletSort';
import { EditWalletModal } from './components/EditWalletModal';
import { DeleteWalletModal } from './components/DeleteWalletModal';
import { WalletVerificationModal } from './components/WalletVerificationModal';
import { DeriveAddressModal } from './components/DeriveAddressModal';
import { AddWalletModal } from './components/AddWalletModal';
import { CryptoActions } from './components/CryptoActions';

const LEDE = 'Verify a wallet to send from it or buy crypto into it.';

export function WalletsPage() {
  const {
    wallets,
    handleCreateWallet,
    handleBatchCreateWallets,
    handleUpdateWalletName,
    handleDeleteWallet,
    handleSyncWallet,
    derivingWallet,
    openDeriveModal,
    closeDeriveModal,
    handleDeriveAddress,
    canDeriveAddress,
    isLoading,
    hasError,
    isRefreshing,
    retry,
    createError,
    updateError,
    deleteError,
    resetCreate,
    resetUpdate,
    resetDelete,
    isDeleting,
    isCreating,
    isUpdating,
    isSyncing,
    syncError,
    syncWalletUuid,
  } = useWallets();

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingWallet, setEditingWallet] = useState<WalletType | null>(null);
  const [deletingWallet, setDeletingWallet] = useState<WalletType | null>(null);
  const [verifyingWallet, setVerifyingWallet] = useState<WalletType | null>(null);
  const sort = useWalletSort();

  const readBlocked = hasError || isRefreshing;
  const readNotice = readBlocked ? (
    <div role={hasError ? 'alert' : 'status'} className="space-y-2 text-sm text-text-muted">
      <p>
        {hasError
          ? 'Wallets could not be refreshed. Your draft is kept; retry before continuing.'
          : 'Refreshing wallets before continuing…'}
      </p>
      {hasError && <PageAction label="Retry wallets" disabled={isRefreshing} onClick={() => void retry()} />}
    </div>
  ) : null;
  const openAdd = () => {
    resetCreate();
    setShowAddModal(true);
  };
  const openEdit = (wallet: WalletType) => {
    resetUpdate();
    setEditingWallet(wallet);
  };
  const openDelete = (wallet: WalletType) => {
    resetDelete();
    setDeletingWallet(wallet);
  };

  const handleAddWalletSubmit = (data: Parameters<typeof handleCreateWallet>[0]) => {
    if (!readBlocked && !isCreating) handleCreateWallet(data, () => setShowAddModal(false));
  };

  const handleBatchSubmit = (addresses: DerivedAddress[], importData: HardwareWalletImport) => {
    if (!readBlocked && !isCreating) handleBatchCreateWallets(addresses, importData, () => setShowAddModal(false));
  };

  const handleSaveWallet = (uuid: string, name: string) => {
    if (!readBlocked && !isUpdating) handleUpdateWalletName(uuid, name, () => setEditingWallet(null));
  };

  const handleConfirmDelete = () => {
    if (deletingWallet && !readBlocked && !isDeleting) {
      handleDeleteWallet(deletingWallet.uuid, () => setDeletingWallet(null));
    }
  };

  const renderWallet = (wallet: WalletType) => (
    <li key={wallet.uuid}>
      <WalletItem wallet={wallet}>
        <WalletActions
          label={wallet.name || wallet.address}
          canVerify={wallet.verificationStatus !== WALLET_VERIFICATION_STATUS.VERIFIED}
          canDerive={canDeriveAddress(wallet)}
          syncing={isSyncing && syncWalletUuid === wallet.uuid}
          syncDisabled={isSyncing}
          onEdit={() => openEdit(wallet)}
          onVerify={() => setVerifyingWallet(wallet)}
          onDerive={() => openDeriveModal(wallet)}
          onSync={() => handleSyncWallet(wallet.uuid)}
          onDelete={() => openDelete(wallet)}
        />
        {syncError && syncWalletUuid === wallet.uuid && (
          <p role="alert" className="text-sm text-error-light">
            {syncError}
          </p>
        )}
      </WalletItem>
    </li>
  );

  const renderChain = (chain: string, title: string) => {
    const chainWallets = sortWallets(
      wallets.filter((wallet) => wallet.chain === chain),
      sort.sortOf(chain),
    );
    return (
      <Section key={chain} title={title}>
        {chainWallets.length > 1 && (
          <WalletSort
            open={sort.isOpen(chain)}
            sort={sort.sortOf(chain)}
            onToggle={() => sort.toggle(chain)}
            onSort={(option) => sort.choose(chain, option)}
          />
        )}
        {chainWallets.length === 0 ? (
          <p className="py-3 text-sm text-text-muted">No {title} wallets yet.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">{chainWallets.map(renderWallet)}</ul>
        )}
      </Section>
    );
  };

  if (isLoading) {
    return <Page loading lede={LEDE} />;
  }

  return (
    <Page
      lede={LEDE}
      actions={
        <>
          {!hasError && <PageAction label="Add wallet" onClick={openAdd} />}
          <CryptoActions wallets={hasError ? null : wallets} />
        </>
      }
    >
      {hasError ? (
        <div role="alert" className="space-y-3">
          <p className="text-sm text-text-muted">Your wallets could not be loaded. Try again before continuing.</p>
          <PageAction label="Try again" disabled={isRefreshing} onClick={() => void retry()} />
        </div>
      ) : (
        getActiveChains().map(({ code, name }) => renderChain(code, name))
      )}

      <AddWalletModal
        isOpen={showAddModal}
        isLoading={isCreating}
        error={createError}
        readBlocked={readBlocked}
        notice={readNotice}
        onClose={() => {
          if (!isCreating) setShowAddModal(false);
        }}
        onSubmit={handleAddWalletSubmit}
        onBatchSubmit={handleBatchSubmit}
      />

      <EditWalletModal
        key={editingWallet?.uuid}
        wallet={editingWallet}
        isOpen={!!editingWallet}
        onClose={() => {
          if (!isUpdating) setEditingWallet(null);
        }}
        onSave={handleSaveWallet}
        isUpdating={isUpdating}
        error={updateError}
        readBlocked={readBlocked}
        notice={readNotice}
      />

      <DeleteWalletModal
        isOpen={!!deletingWallet}
        wallet={deletingWallet}
        isDeleting={isDeleting}
        error={deleteError}
        readBlocked={readBlocked}
        notice={readNotice}
        onConfirm={handleConfirmDelete}
        onClose={() => {
          if (!isDeleting) setDeletingWallet(null);
        }}
      />

      <WalletVerificationModal
        isOpen={!!verifyingWallet}
        wallet={verifyingWallet}
        onClose={() => setVerifyingWallet(null)}
      />

      <DeriveAddressModal
        isOpen={!!derivingWallet}
        wallet={derivingWallet}
        onConfirm={handleDeriveAddress}
        onClose={closeDeriveModal}
        isCreating={isCreating}
        requestError={createError}
        readBlocked={readBlocked || (!!derivingWallet && !canDeriveAddress(derivingWallet))}
        notice={readNotice}
      />
    </Page>
  );
}

export default WalletsPage;

import { useCallback, useState } from 'react';
import { FunnelIcon } from '@phosphor-icons/react';
import { BLOCKCHAIN, WALLET_VERIFICATION_STATUS, DESIGN_TOKENS } from '@ledova/shared';

const ICON_SM = DESIGN_TOKENS.icon.sizes.sm;
import type { Wallet as WalletType, DerivedAddress, HardwareWalletImport } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Section } from '@components/Ledger';
import { WalletList } from '@components/Wallet';
import { useWallets } from './hooks/useWallets';
import { useWalletSort } from './hooks/useWalletSort';
import { WalletActionBar } from './components/WalletActionBar';
import { WalletSortModal } from './components/WalletSortModal';
import { EditWalletModal } from './components/EditWalletModal';
import { DeleteWalletModal } from './components/DeleteWalletModal';
import { WalletVerificationModal } from './components/WalletVerificationModal';
import { DeriveAddressModal } from './components/DeriveAddressModal';
import { AddWalletModal } from './components/AddWalletModal';
import { CryptoActions } from './components/CryptoActions';

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
    syncErrorWalletUuid,
  } = useWallets();

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingWallet, setEditingWallet] = useState<WalletType | null>(null);
  const [deletingWallet, setDeletingWallet] = useState<WalletType | null>(null);
  const [verifyingWallet, setVerifyingWallet] = useState<WalletType | null>(null);
  const [selectedWalletUuid, setSelectedWalletUuid] = useState<string | null>(null);

  const { sortedWallets, sortOption, isFiltered, showSortModal, setShowSortModal, handleApply } =
    useWalletSort(wallets);

  const ethWallets = sortedWallets.filter((w) => w.chain === BLOCKCHAIN.ETHEREUM);
  const btcWallets = sortedWallets.filter((w) => w.chain === BLOCKCHAIN.BITCOIN);
  const baseWallets = sortedWallets.filter((w) => w.chain === BLOCKCHAIN.BASE);

  const selectedWallet = wallets.find((w) => w.uuid === selectedWalletUuid) ?? null;

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

  const handleSelectWallet = useCallback((wallet: WalletType) => {
    setSelectedWalletUuid((prev) => (prev === wallet.uuid ? null : wallet.uuid));
  }, []);

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
      handleDeleteWallet(deletingWallet.uuid, () => {
        if (selectedWalletUuid === deletingWallet.uuid) setSelectedWalletUuid(null);
        setDeletingWallet(null);
      });
    }
  };

  const buildActionBarProps = (chain: string) => {
    const walletForChain = selectedWallet?.chain === chain ? selectedWallet : null;
    const isPending = walletForChain
      ? walletForChain.verificationStatus !== WALLET_VERIFICATION_STATUS.VERIFIED
      : false;
    const canDerive = walletForChain ? canDeriveAddress(walletForChain) : false;

    return {
      selectedWallet: walletForChain,
      canVerify: isPending,
      canDerive,
      isSyncing,
      onAdd: openAdd,
      onEdit: () => walletForChain && openEdit(walletForChain),
      onVerify: () => walletForChain && setVerifyingWallet(walletForChain),
      onDerive: () => walletForChain && openDeriveModal(walletForChain),
      onSync: () => walletForChain && handleSyncWallet(walletForChain.uuid),
      onDelete: () => walletForChain && openDelete(walletForChain),
    };
  };

  const renderChain = (chain: string, title: string, chainWallets: WalletType[]) => (
    <Section title={title}>
      {chainWallets.length === 0 ? (
        <>
          <p className="py-3 text-sm text-text-muted">No {title} wallets yet.</p>
          <div>
            <PageAction label="Add wallet" onClick={openAdd} />
          </div>
        </>
      ) : (
        <>
          <WalletList
            wallets={chainWallets}
            selectedWalletUuid={selectedWalletUuid}
            onSelectWallet={handleSelectWallet}
            onEditWallet={openEdit}
          />
          <WalletActionBar {...buildActionBarProps(chain)} />
          {syncError && syncErrorWalletUuid === selectedWalletUuid && selectedWallet?.chain === chain && (
            <p role="alert" className="mt-3 text-sm text-error-light">
              {syncError}
            </p>
          )}
        </>
      )}
    </Section>
  );

  if (isLoading) {
    return <Page loading />;
  }

  return (
    <Page
      actions={
        <>
          <PageAction
            icon={<FunnelIcon size={ICON_SM} weight={isFiltered ? 'fill' : 'regular'} />}
            label="Filter"
            onClick={() => setShowSortModal(true)}
            active={isFiltered}
          />
          <CryptoActions />
        </>
      }
    >
      {hasError ? (
        <div role="alert" className="space-y-3">
          <p className="text-sm text-text-muted">Your wallets could not be loaded. Try again before continuing.</p>
          <PageAction label="Try again" disabled={isRefreshing} onClick={() => void retry()} />
        </div>
      ) : (
        <>
          <p className="text-sm text-text-muted">
            Select a wallet to edit, verify, derive an address or sync its balances.
          </p>
          {renderChain(BLOCKCHAIN.ETHEREUM, 'Ethereum', ethWallets)}
          {renderChain(BLOCKCHAIN.BITCOIN, 'Bitcoin', btcWallets)}
          {renderChain(BLOCKCHAIN.BASE, 'Base', baseWallets)}
        </>
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

      <WalletSortModal
        isOpen={showSortModal}
        selectedSort={sortOption}
        onClose={() => setShowSortModal(false)}
        onApply={handleApply}
      />
    </Page>
  );
}

export default WalletsPage;

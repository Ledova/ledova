import { useRef, useState } from 'react';
import type { CreateWallet, DerivedAddress, HardwareWalletImport } from '@ledova/shared';
import { getChainByShortName, getErrorMessage, importedParentKey, importAddressKey } from '@ledova/shared';
import { useWalletsCrud } from './useWalletsCrud';
import { assertSessionEpoch, getSessionEpoch } from '../../services/sessionScope';
import type { SoftwareWalletImport } from '../../utils/softwareWallet';

export function useWallets(crud: ReturnType<typeof useWalletsCrud>) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const pending = useRef(false);
  const confirmed = useRef(new Set<string>());
  const closeAddModal = () => {
    if (!pending.current) setShowAddModal(false);
  };
  const openAddModal = () => {
    confirmed.current.clear();
    setCreateError(null);
    setShowAddModal(true);
  };
  const create = async (operation: (epoch: number) => Promise<void>) => {
    if (pending.current || crud.isLoading || crud.isRefreshing || crud.hasError) return;
    const epoch = getSessionEpoch();
    pending.current = true;
    setIsCreating(true);
    setCreateError(null);
    try {
      await operation(epoch);
      assertSessionEpoch(epoch);
      setShowAddModal(false);
    } catch (error) {
      if (epoch === getSessionEpoch()) {
        setCreateError(getErrorMessage(error, 'Wallets could not be added. Your selection is kept; try again.'));
      }
      throw error;
    } finally {
      pending.current = false;
      setIsCreating(false);
    }
  };
  const handleCreateWallet = (data: CreateWallet) =>
    create(async () => {
      await crud.createWallet(data);
    });
  const createBatch = (
    addresses: DerivedAddress[],
    importData: HardwareWalletImport | SoftwareWalletImport,
    signingPreference: 'hardware' | 'software',
  ) =>
    create(async (epoch) => {
      if (!addresses.length) throw new Error('Select at least one wallet.');
      for (const address of addresses) {
        assertSessionEpoch(epoch);
        const key = importAddressKey(address);
        if (confirmed.current.has(key)) continue;
        const chain = getChainByShortName(address.networkType);
        if (!chain?.isActive) throw new Error('This wallet network is not available.');
        const parentKey = importedParentKey(address, importData);
        await crud.createWallet({
          address: address.address,
          chain: chain.code,
          signingPreference,
          derivationPath: address.derivationPath,
          masterFingerprint: importData.masterFingerprint,
          addressIndex: address.addressIndex,
          parentPublicKey: parentKey?.parentPublicKey,
          parentChainCode: parentKey?.parentChainCode,
          parentDerivationPath: parentKey?.parentDerivationPath,
        });
        assertSessionEpoch(epoch);
        confirmed.current.add(key);
      }
    });
  return {
    isCreating,
    showAddModal,
    createError,
    handleCreateWallet,
    handleBatchCreateWallets: (addresses: DerivedAddress[], importData: HardwareWalletImport) =>
      createBatch(addresses, importData, 'hardware'),
    handleSoftwareWalletCreate: (addresses: DerivedAddress[], importData: SoftwareWalletImport) =>
      createBatch(addresses, importData, 'software'),
    openAddModal,
    closeAddModal,
  };
}

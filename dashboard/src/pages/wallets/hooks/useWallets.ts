import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getWallets,
  createWallet,
  updateWallet,
  deleteWallet,
  syncWallet,
  CACHE_TIMING,
  getChainByShortName,
  getErrorMessage,
  getNextPageParam,
  importedParentKey,
  canDeriveNextWalletAddress,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import type { Wallet, CreateWallet, DerivedAddress, HardwareWalletImport } from '@ledova/shared';

export function useWallets() {
  const queryClient = useQueryClient();
  const [derivingWallet, setDerivingWallet] = useState<Wallet | null>(null);
  const imported = useRef(new Set<string>());
  const walletsQuery = useQuery({
    queryKey: ['wallets', 'ledger'],
    queryFn: async () => {
      const wallets: Wallet[] = [];
      let page: number | undefined = 1;
      while (page !== undefined) {
        const { data } = await getWallets(apiClient, { page });
        wallets.push(...data.results);
        const next = getNextPageParam(data);
        if (data.next && (next === undefined || !Number.isInteger(next) || next <= page)) {
          throw new Error('Wallet pagination did not advance');
        }
        page = next;
      }
      return wallets;
    },
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['wallets'] });
  const createMutation = useMutation({
    mutationFn: (data: CreateWallet) => createWallet(apiClient, data),
    onSuccess: refresh,
  });
  const importMutation = useMutation({
    mutationFn: async ({
      addresses,
      importData,
    }: {
      addresses: DerivedAddress[];
      importData: HardwareWalletImport;
    }) => {
      const requests = addresses.map((addr): CreateWallet => {
        const chain = getChainByShortName(addr.networkType);
        if (!chain?.isActive) throw new Error('Choose addresses on a supported network.');
        return {
          address: addr.address,
          chain: chain.code,
          derivationPath: addr.derivationPath,
          masterFingerprint: importData.masterFingerprint,
          addressIndex: addr.addressIndex,
          ...importedParentKey(addr, importData),
        };
      });
      for (const data of requests) {
        const key = `${data.chain}:${data.address}`;
        if (imported.current.has(key)) continue;
        try {
          await createWallet(apiClient, data);
          imported.current.add(key);
        } catch (error) {
          throw new Error(
            `${imported.current.size} wallet(s) added. ${getErrorMessage(error, 'The remaining import could not finish.')} Retry keeps the confirmed additions.`,
          );
        }
      }
    },
    onSettled: refresh,
  });
  const updateMutation = useMutation({
    mutationFn: ({ uuid, name }: { uuid: string; name: string }) => updateWallet(apiClient, uuid, { name }),
    onSuccess: refresh,
  });
  const deleteMutation = useMutation({
    mutationFn: (uuid: string) => deleteWallet(apiClient, uuid),
    onSuccess: refresh,
  });
  const syncMutation = useMutation({ mutationFn: (uuid: string) => syncWallet(apiClient, uuid), onSettled: refresh });
  const wallets = walletsQuery.data ?? [];
  const canDeriveAddress = useCallback((wallet: Wallet) => canDeriveNextWalletAddress(wallet, wallets), [wallets]);
  const resetCreate = () => {
    imported.current.clear();
    createMutation.reset();
    importMutation.reset();
  };
  const openDeriveModal = (wallet: Wallet) => {
    resetCreate();
    setDerivingWallet(wallet);
  };
  const handleDeriveAddress = (derivedAddress: DerivedAddress) => {
    if (
      !derivingWallet ||
      !canDeriveAddress(derivingWallet) ||
      walletsQuery.isError ||
      walletsQuery.isFetching ||
      createMutation.isPending
    )
      return;
    createMutation.mutate(
      {
        address: derivedAddress.address,
        chain: derivingWallet.chain,
        derivationPath: derivedAddress.derivationPath,
        masterFingerprint: derivingWallet.masterFingerprint,
        addressIndex: derivedAddress.addressIndex,
        parentPublicKey: derivingWallet.parentPublicKey,
        parentChainCode: derivingWallet.parentChainCode,
        parentDerivationPath: derivingWallet.parentDerivationPath,
      },
      { onSuccess: () => setDerivingWallet(null) },
    );
  };
  return {
    wallets,
    derivingWallet,
    isLoading: walletsQuery.isPending,
    hasError: walletsQuery.isError,
    isRefreshing: walletsQuery.isFetching,
    retry: walletsQuery.refetch,
    isCreating: createMutation.isPending || importMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isSyncing: syncMutation.isPending,
    createError: getErrorMessage(
      importMutation.error ?? createMutation.error,
      'The wallet could not be added. Try again.',
    ),
    updateError: getErrorMessage(updateMutation.error, 'The wallet could not be saved. Try again.'),
    deleteError: getErrorMessage(deleteMutation.error, 'The wallet could not be deleted. Try again.'),
    syncError: getErrorMessage(syncMutation.error, 'Wallet sync could not finish. Please try again later.'),
    syncWalletUuid: syncMutation.variables,
    resetCreate,
    resetUpdate: updateMutation.reset,
    resetDelete: deleteMutation.reset,
    handleCreateWallet: (data: CreateWallet, onSuccess: () => void) => createMutation.mutate(data, { onSuccess }),
    handleBatchCreateWallets: (addresses: DerivedAddress[], importData: HardwareWalletImport, onSuccess: () => void) =>
      importMutation.mutate({ addresses, importData }, { onSuccess }),
    handleUpdateWalletName: (uuid: string, name: string, onSuccess: () => void) =>
      updateMutation.mutate({ uuid, name }, { onSuccess }),
    handleDeleteWallet: (uuid: string, onSuccess: () => void) => deleteMutation.mutate(uuid, { onSuccess }),
    handleSyncWallet: (uuid: string) => syncMutation.mutate(uuid),
    openDeriveModal,
    closeDeriveModal: () => {
      if (!createMutation.isPending) setDerivingWallet(null);
    },
    handleDeriveAddress,
    canDeriveAddress,
  };
}

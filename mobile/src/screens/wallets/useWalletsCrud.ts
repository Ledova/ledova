import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getWallets,
  createWallet,
  updateWallet,
  deleteWallet,
  syncWallet,
  getErrorMessage,
  CACHE_TIMING,
  readEveryPage,
  useUserPreferences,
} from '@ledova/shared';
import type { CreateWallet } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch, subscribeSession } from '../../services/sessionScope';

export function useWalletsCrud() {
  const queryClient = useQueryClient();
  const owner = useUserPreferences();
  const { userAccount } = owner;
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch, getSessionEpoch);
  const [syncingWalletIds, setSyncingWalletIds] = useState<Set<string>>(() => new Set());
  const pendingSyncs = useRef(new Map<string, ReturnType<typeof syncWallet>>());

  const walletsQuery = useQuery({
    queryKey: ['wallets', 'ledger', userAccount?.uuid, epoch],
    queryFn: () =>
      readEveryPage(async (page) => {
        assertSessionEpoch(epoch);
        const response = await getWallets(apiClient, { page }, { ledovaSessionEpoch: epoch });
        assertSessionEpoch(epoch);
        return response;
      }),
    enabled: !!userAccount?.uuid,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['wallets'] });

  const createMutation = useMutation({
    mutationFn: async ({ data, epoch: captured }: { data: CreateWallet; epoch: number }) => {
      assertSessionEpoch(captured);
      const response = await createWallet(apiClient, data, { ledovaSessionEpoch: captured });
      assertSessionEpoch(captured);
      return response;
    },
    onSuccess: refresh,
  });
  const updateMutation = useMutation({
    mutationFn: async ({ uuid, name, epoch: captured }: { uuid: string; name: string; epoch: number }) => {
      assertSessionEpoch(captured);
      const response = await updateWallet(apiClient, uuid, { name }, { ledovaSessionEpoch: captured });
      assertSessionEpoch(captured);
      return response;
    },
    onSuccess: refresh,
  });
  const deleteMutation = useMutation({
    mutationFn: async ({ uuid, epoch: captured }: { uuid: string; epoch: number }) => {
      assertSessionEpoch(captured);
      const response = await deleteWallet(apiClient, uuid, { ledovaSessionEpoch: captured });
      assertSessionEpoch(captured);
      return response;
    },
    onSuccess: refresh,
  });
  const syncMutation = useMutation({
    mutationFn: async ({ uuid, epoch: captured }: { uuid: string; epoch: number }) => {
      assertSessionEpoch(captured);
      const response = await syncWallet(apiClient, uuid, { ledovaSessionEpoch: captured });
      assertSessionEpoch(captured);
      return response;
    },
    onError: (error, { epoch: captured }) => {
      if (captured === getSessionEpoch())
        Alert.alert(
          'Wallet not synced',
          getErrorMessage(error, 'Wallet sync could not finish. Please try again later.') ||
            'Wallet sync could not finish. Please try again later.',
        );
    },
    onMutate: ({ uuid }) => setSyncingWalletIds((pending) => new Set(pending).add(uuid)),
    onSettled: async (_data, _error, { uuid, epoch: captured }) => {
      setSyncingWalletIds((pending) => {
        const next = new Set(pending);
        next.delete(uuid);
        return next;
      });
      if (captured !== getSessionEpoch()) return;
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ['all-transactions'] });
    },
  });
  const { mutateAsync } = syncMutation;
  const syncWalletOnce = useCallback(
    (uuid: string) => {
      const captured = getSessionEpoch();
      const key = `${captured}:${uuid}`;
      const pending = pendingSyncs.current.get(key);
      if (pending) return pending;
      const request = mutateAsync({ uuid, epoch: captured }).finally(() => pendingSyncs.current.delete(key));
      pendingSyncs.current.set(key, request);
      return request;
    },
    [mutateAsync],
  );

  return {
    wallets: walletsQuery.data ?? [],
    isLoading: owner.isLoading || walletsQuery.isLoading,
    hasError: owner.isError || (!owner.isLoading && !userAccount?.uuid) || walletsQuery.isError,
    isRefreshing: walletsQuery.isFetching,
    isSettled: walletsQuery.fetchStatus === 'idle',
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    isSyncing: syncingWalletIds.size > 0,
    syncingWalletIds,
    createWallet: (data: CreateWallet) => createMutation.mutateAsync({ data, epoch: getSessionEpoch() }),
    updateWallet: (uuid: string, name: string) => updateMutation.mutateAsync({ uuid, name, epoch: getSessionEpoch() }),
    deleteWallet: (uuid: string) => deleteMutation.mutateAsync({ uuid, epoch: getSessionEpoch() }),
    syncWallet: syncWalletOnce,
    refetch: async () => {
      if (owner.isError || !userAccount?.uuid) await owner.refetch();
      return walletsQuery.refetch();
    },
  };
}

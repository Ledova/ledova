import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { useMutation, useQueries } from '@tanstack/react-query';
import {
  BUYABLE_ASSETS,
  CACHE_TIMING,
  getAssets,
  useBuyWallets,
  getOnRampWidgetUrl,
  useCurrency,
  useUserPreferences,
  canOpen,
  type BuyableAssetConfig,
  type Wallet,
} from '@ledova/shared';
import apiClient from '@services/apiClient';

export interface BuyCryptoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToWidget: (url: string) => void;
  userAccountUuid?: string;
}

export function useBuyCryptoModal({ isOpen, onClose, onNavigateToWidget, userAccountUuid }: BuyCryptoModalProps) {
  const { exchangeRate, formatDisplayCurrency } = useCurrency();
  const { userAccount } = useUserPreferences();
  const canPurchase =
    !!userAccountUuid && userAccount?.uuid === userAccountUuid && canOpen(userAccount.role, 'investing');
  const [selectedAsset, setSelectedAsset] = useState<BuyableAssetConfig | null>(null);
  const scope = useMemo(
    () => ({ isOpen, userAccountUuid, canPurchase, selectedAsset }),
    [isOpen, userAccountUuid, canPurchase, selectedAsset],
  );
  const current = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    current.current = scope;
    return () => {
      if (current.current === scope) current.current = null;
    };
  }, [scope]);
  const isCurrent = (candidate: typeof scope) =>
    current.current === candidate && candidate.isOpen && candidate.canPurchase;

  const priceQueries = useQueries({
    queries: BUYABLE_ASSETS.map((asset) => ({
      queryKey: ['buyable-asset-price', asset.symbol],
      queryFn: () => getAssets(apiClient, { symbol: asset.symbol, is_active: true }),
      enabled: isOpen && canPurchase,
      staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    })),
  });
  const currentPriceOf = (index: number) => {
    const price = parseFloat(priceQueries[index]?.data?.data.results[0]?.currentPrice ?? '');
    return Number.isFinite(price) && exchangeRate ? formatDisplayCurrency(price) : null;
  };

  const walletsQuery = useBuyWallets(userAccountUuid, () => selectedAsset, isOpen && canPurchase && !!selectedAsset);

  const walletsFailed = walletsQuery.isError;
  const matchingWallets = walletsFailed ? [] : (walletsQuery.data ?? []);
  const isLoadingWallets = walletsQuery.isPending;
  const walletsSettled = walletsQuery.fetchStatus === 'idle';
  const showWalletStep = !!selectedAsset && !isLoadingWallets && matchingWallets.length !== 1;

  const widgetMutation = useMutation({
    mutationFn: async (wallet: Wallet) => {
      if (!isCurrent(scope)) throw new Error('The purchase request is no longer active.');
      const response = await getOnRampWidgetUrl(apiClient, {
        walletUuid: wallet.uuid,
        cryptoCurrencyCode: selectedAsset!.symbol,
      });
      return { response, scope };
    },
    onSuccess: ({ response, scope: requestedScope }) => {
      if (!isCurrent(requestedScope)) return;
      resetAndClose();
      onNavigateToWidget(response.data.url);
    },
  });

  useEffect(() => {
    if (!isOpen || !canPurchase || !selectedAsset || !walletsSettled) return;

    if (matchingWallets.length === 1 && widgetMutation.isIdle) {
      widgetMutation.mutate(matchingWallets[0]);
    }
  }, [isOpen, canPurchase, selectedAsset, walletsSettled, matchingWallets, widgetMutation]);

  const resetAndClose = useCallback(() => {
    current.current = null;
    setSelectedAsset(null);
    widgetMutation.reset();
  }, [scope, widgetMutation]);

  const handleClose = useCallback(() => {
    resetAndClose();
    onClose();
  }, [resetAndClose, onClose]);

  const handleSelectAsset = (asset: BuyableAssetConfig) => {
    setSelectedAsset(asset);
  };

  const handleSelectWallet = (wallet: Wallet) => {
    widgetMutation.mutate(wallet);
  };

  const isOnAssetStep = !showWalletStep;
  const isProcessingAsset = !!selectedAsset && isOnAssetStep;
  const isLoading = widgetMutation.isPending;

  return {
    canPurchase,
    selectedAsset,
    currentPriceOf,
    walletsQuery,
    walletsFailed,
    matchingWallets,
    walletsSettled,
    widgetMutation,
    resetAndClose,
    handleClose,
    handleSelectAsset,
    handleSelectWallet,
    isOnAssetStep,
    isProcessingAsset,
    isLoading,
  };
}

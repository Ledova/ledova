import { useState, useEffect, useCallback } from 'react';
import { CurrencyEthIcon, CurrencyBtcIcon, CurrencyCircleDollarIcon, SpinnerGapIcon } from '@phosphor-icons/react';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import {
  BUYABLE_ASSETS,
  CACHE_TIMING,
  DESIGN_TOKENS,
  getAssets,
  getWallets,
  getOnRampWidgetUrl,
  readEveryPage,
  useCurrency,
} from '@ledova/shared';
import type { BuyableAssetConfig, Wallet } from '@ledova/shared';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import { WalletChoice } from '@components/Wallet';
import apiClient from '@services/apiClient';

const ICON_MD = DESIGN_TOKENS.icon.sizes.md;
const ICON_SM = DESIGN_TOKENS.icon.sizes.sm;

const ASSET_ICONS: Record<string, React.ReactNode> = {
  BTC: <CurrencyBtcIcon size={ICON_MD} className="text-text-primary" />,
  ETH: <CurrencyEthIcon size={ICON_MD} className="text-text-primary" />,
  USDC: <CurrencyCircleDollarIcon size={ICON_MD} className="text-text-primary" />,
  USDT: <CurrencyCircleDollarIcon size={ICON_MD} className="text-text-primary" />,
};

interface BuyCryptoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToWidget: (url: string) => void;
  userAccountUuid?: string;
}

export function BuyCryptoModal({ isOpen, onClose, onNavigateToWidget, userAccountUuid }: BuyCryptoModalProps) {
  const { exchangeRate, formatDisplayCurrency } = useCurrency();
  const [selectedAsset, setSelectedAsset] = useState<BuyableAssetConfig | null>(null);

  const priceQueries = useQueries({
    queries: BUYABLE_ASSETS.map((asset) => ({
      queryKey: ['buyable-asset-price', asset.symbol],
      queryFn: () => getAssets(apiClient, { symbol: asset.symbol, is_active: true }),
      enabled: isOpen,
      staleTime: CACHE_TIMING.SHORT_STALE_TIME,
    })),
  });
  const currentPriceOf = (index: number) => {
    const price = parseFloat(priceQueries[index]?.data?.data.results[0]?.currentPrice ?? '');
    return Number.isFinite(price) && exchangeRate ? formatDisplayCurrency(price) : null;
  };

  const walletsQuery = useQuery({
    queryKey: [
      'wallets',
      userAccountUuid,
      { chain: selectedAsset?.chain, verification_status: 'VERIFIED', ordering: 'signing_preference' },
    ],
    queryFn: () =>
      readEveryPage((page) =>
        getWallets(apiClient, {
          chain: selectedAsset!.chain,
          verification_status: 'VERIFIED',
          ordering: 'signing_preference',
          page,
        }),
      ),
    enabled: !!userAccountUuid && !!selectedAsset,
  });

  const walletsFailed = walletsQuery.isError;
  const matchingWallets = walletsFailed ? [] : (walletsQuery.data ?? []);
  const isLoadingWallets = walletsQuery.isPending;
  const walletsSettled = walletsQuery.fetchStatus === 'idle';
  const showWalletStep = !!selectedAsset && !isLoadingWallets && matchingWallets.length !== 1;

  const widgetMutation = useMutation({
    mutationFn: (wallet: Wallet) =>
      getOnRampWidgetUrl(apiClient, {
        walletUuid: wallet.uuid,
        cryptoCurrencyCode: selectedAsset!.symbol,
      }),
    onSuccess: (response) => {
      resetAndClose();
      onNavigateToWidget(response.data.url);
    },
  });

  useEffect(() => {
    if (!selectedAsset || !walletsSettled) return;

    if (matchingWallets.length === 1 && widgetMutation.isIdle) {
      widgetMutation.mutate(matchingWallets[0]);
    }
  }, [selectedAsset, walletsSettled, matchingWallets, widgetMutation]);

  const resetAndClose = useCallback(() => {
    setSelectedAsset(null);
    widgetMutation.reset();
  }, [widgetMutation]);

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

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Buy crypto"
      showFooter
      showCancelButton
      cancelLabel={isOnAssetStep ? 'Cancel' : 'Back'}
      onCancel={isOnAssetStep ? handleClose : resetAndClose}
    >
      {isOnAssetStep && (
        <>
          <p className="text-sm text-text-muted">Select an asset to purchase</p>

          <div className="mt-2 divide-y divide-border-subtle">
            {BUYABLE_ASSETS.map((asset, index) => {
              const isAssetProcessing = isProcessingAsset && selectedAsset?.symbol === asset.symbol;
              const currentPrice = currentPriceOf(index);

              return (
                <button
                  key={asset.symbol}
                  type="button"
                  className="flex w-full items-center justify-between py-3 text-left disabled:opacity-50"
                  onClick={() => handleSelectAsset(asset)}
                  disabled={isProcessingAsset}
                >
                  <div className="flex items-center gap-3">
                    {ASSET_ICONS[asset.symbol]}
                    <span className="text-sm font-medium text-text-primary">{asset.name}</span>
                  </div>
                  {isAssetProcessing ? (
                    <SpinnerGapIcon size={ICON_SM} className="animate-spin text-brand-mid" />
                  ) : (
                    currentPrice && <span className="text-sm tabular-nums text-text-muted">{currentPrice}</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {!isOnAssetStep && walletsFailed && (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-sm text-text-muted">Your wallets could not be loaded. Try again before continuing.</p>
          <PageAction
            label="Try again"
            disabled={walletsQuery.isFetching}
            onClick={() => void walletsQuery.refetch()}
          />
        </div>
      )}

      {!isOnAssetStep && !walletsFailed && matchingWallets.length === 0 && (
        <p className="text-sm text-text-muted">No verified wallets for {selectedAsset!.name}. Create one in Wallets.</p>
      )}

      {!isOnAssetStep && matchingWallets.length > 1 && (
        <>
          <p className="text-sm text-text-muted">Choose a wallet to receive {selectedAsset!.name}</p>

          <ul className="mt-2 divide-y divide-border-subtle">
            {matchingWallets.map((wallet) => (
              <li key={wallet.uuid}>
                <WalletChoice
                  wallet={wallet}
                  onChoose={() => handleSelectWallet(wallet)}
                  disabled={isLoading || !walletsSettled}
                  busy={isLoading && widgetMutation.variables?.uuid === wallet.uuid}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {widgetMutation.isError && (
        <p className="mt-4 text-sm text-error-light">
          {widgetMutation.error instanceof Error ? widgetMutation.error.message : 'Something went wrong'}
        </p>
      )}
    </Modal>
  );
}

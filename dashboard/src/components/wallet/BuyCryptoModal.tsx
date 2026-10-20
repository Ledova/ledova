import { CurrencyEthIcon, CurrencyBtcIcon, CurrencyCircleDollarIcon, SpinnerGapIcon } from '@phosphor-icons/react';
import { BUYABLE_ASSETS, readApiError } from '@ledova/shared';
import { ICON_SM, ICON_MD } from '@components/iconSizes';
import { Modal } from '@components/Modal';
import { WalletChoice } from '@components/wallet';
import { useBuyCryptoModal, type BuyCryptoModalProps } from './useBuyCryptoModal';
import { LoadError } from '@components/Ledger';

const ASSET_ICONS: Record<string, React.ReactNode> = {
  BTC: <CurrencyBtcIcon size={ICON_MD} className="text-text-primary" />,
  ETH: <CurrencyEthIcon size={ICON_MD} className="text-text-primary" />,
  USDC: <CurrencyCircleDollarIcon size={ICON_MD} className="text-text-primary" />,
  USDT: <CurrencyCircleDollarIcon size={ICON_MD} className="text-text-primary" />,
};

export function BuyCryptoModal({ isOpen, onClose, onNavigateToWidget, userAccountUuid }: BuyCryptoModalProps) {
  const {
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
  } = useBuyCryptoModal({ isOpen, onClose, onNavigateToWidget, userAccountUuid });

  return (
    <Modal
      isOpen={isOpen && canPurchase}
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
                  aria-busy={isAssetProcessing || undefined}
                >
                  <div className="flex items-center gap-3">
                    {ASSET_ICONS[asset.symbol]}
                    <span className="text-sm font-medium text-text-primary">{asset.name}</span>
                  </div>
                  {isAssetProcessing ? (
                    <SpinnerGapIcon size={ICON_SM} className="animate-spin text-brand-light" />
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
        <LoadError retry={() => walletsQuery.refetch()} busy={walletsQuery.isFetching}>
          Your wallets could not be loaded.
        </LoadError>
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
          {
            readApiError(widgetMutation.error, {
              fallback: 'The purchase page could not be opened. Try again.',
              displayedFields: [],
            }).generalError
          }
        </p>
      )}
    </Modal>
  );
}

import { useState, useEffect } from 'react';
import {
  CurrencyEthIcon,
  CurrencyBtcIcon,
  QrCodeIcon,
  ArrowsClockwiseIcon,
  CertificateIcon,
  CurrencyCircleDollarIcon,
  ShieldWarningIcon,
  ShieldCheckIcon,
} from '@phosphor-icons/react';
import {
  getChainShortCode,
  BLOCKCHAIN,
  getAddressPlaceholder,
  getBlockchainDisplayName,
  getEstimatedFee,
  formatPlainDecimal,
  formatWalletAddressShort,
  validateWalletAddress,
  parseFiatValue,
  useCurrency,
} from '@ledova/shared';
import { ICON_XS, ICON_SM, ICON_MD, ICON_LG } from '@components/iconSizes';
import type { Wallet, WhitelistStatus } from '@ledova/shared';
import { Modal } from '@components/Modal';
import { useQRScanner, QRScannerView } from '@components/qr';
import type { UnifiedAsset } from '../hooks/useTransferFlow';

const FIELD_CLASS =
  'block w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary ' +
  'placeholder:text-text-muted focus:border-brand-mid focus:outline-none focus:ring-1 focus:ring-brand-mid';

interface SendFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallet: Wallet;
  assets: UnifiedAsset[];
  isLoadingAssets: boolean;
  hasShareTokens: boolean;
  isSenderWhitelisted: boolean;
  isRecipientWhitelisted: boolean;
  isCheckingRecipientWhitelist: boolean;
  senderWhitelistStatus?: WhitelistStatus;
  recipientWhitelistStatus?: WhitelistStatus;
  onBack?: () => void;
  onTransfer: (asset: UnifiedAsset, toAddress: string, amount: string) => void;
  onAssetChange?: (asset: UnifiedAsset | null) => void;
  onAddressChange?: (address: string) => void;
}

export function SendFormModal({
  isOpen,
  onClose,
  wallet,
  assets,
  isLoadingAssets,
  hasShareTokens,
  isSenderWhitelisted,
  isRecipientWhitelisted,
  isCheckingRecipientWhitelist,
  senderWhitelistStatus,
  recipientWhitelistStatus,
  onBack,
  onTransfer,
  onAddressChange,
  onAssetChange,
}: SendFormModalProps) {
  const { formatDisplayCurrency } = useCurrency();
  const [chosenAsset, setChosenAsset] = useState<UnifiedAsset | null>(null);
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [showAddressScanner, setShowAddressScanner] = useState(false);
  const [wasOpen, setWasOpen] = useState(isOpen);
  const selectedAsset = chosenAsset ?? (isLoadingAssets ? null : (assets[0] ?? null));

  const chainShortCode = getChainShortCode(wallet.chain);
  const isBitcoin = wallet.chain === BLOCKCHAIN.BITCOIN;
  const ChainIcon = isBitcoin ? CurrencyBtcIcon : CurrencyEthIcon;
  const displayAddress = formatWalletAddressShort(wallet.address);

  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setChosenAsset(null);
      setToAddress('');
      setAmount('');
      setShowAddressScanner(false);
    }
  }

  useEffect(() => {
    if (isOpen) onAddressChange?.('');
  }, [isOpen, onAddressChange]);

  useEffect(() => {
    if (isOpen) onAssetChange?.(selectedAsset);
  }, [isOpen, selectedAsset, onAssetChange]);

  const handleAddressChange = (address: string) => {
    setToAddress(address);
    onAddressChange?.(address);
  };

  const { error: scannerError } = useQRScanner({
    scannerId: 'send-form-address-scanner',
    onScanSuccess: (text) => {
      let address = text;
      if (address.startsWith('ethereum:')) {
        address = address.replace('ethereum:', '').split('@')[0];
      } else if (address.startsWith('bitcoin:')) {
        address = address.replace('bitcoin:', '').split('?')[0];
      }
      handleAddressChange(address);
      setShowAddressScanner(false);
    },
    enabled: showAddressScanner && isOpen,
    qrboxSize: 200,
  });

  const isSenderWhitelistUnknown = senderWhitelistStatus?.status === 'unknown';
  const isRecipientWhitelistUnknown = recipientWhitelistStatus?.status === 'unknown';

  const isShareToken = selectedAsset?.type === 'share_token';
  const isCrypto = selectedAsset?.type === 'crypto';

  const isValidAddress = isBitcoin
    ? validateWalletAddress(toAddress, wallet.chain)
    : toAddress.length === 42 && toAddress.startsWith('0x');

  const parsedAmount = parseFloat(amount);
  const parsedBalance = parseFloat(selectedAsset?.displayBalance.replace(/,/g, '') || '0');
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= parsedBalance;

  const whitelistValid = isShareToken ? isSenderWhitelisted && isRecipientWhitelisted : true;
  const canTransfer = !!selectedAsset && isValidAddress && isValidAmount && whitelistValid;

  const handleUseMax = () => {
    if (!selectedAsset) return;
    if (isCrypto) {
      const balance = parseFloat(wallet.nativeBalance);
      const estimatedFee = getEstimatedFee(chainShortCode);
      const maxAmount = Math.max(0, balance - estimatedFee);
      setAmount(formatPlainDecimal(maxAmount, 8));
    } else {
      setAmount(selectedAsset.displayBalance.replace(/,/g, ''));
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isShareToken) {
      setAmount(e.target.value.replace(/[^0-9]/g, ''));
    } else {
      setAmount(e.target.value.replace(/[^0-9.]/g, ''));
    }
  };

  const handleConfirm = () => {
    if (canTransfer && selectedAsset) {
      onTransfer(selectedAsset, toAddress, amount);
    }
  };

  const getAssetIcon = (asset: UnifiedAsset, selected: boolean) => {
    const colorClass = selected ? 'text-brand-light' : 'text-text-muted';
    switch (asset.type) {
      case 'share_token':
        return <CertificateIcon size={ICON_MD} className={colorClass} weight={selected ? 'duotone' : 'regular'} />;
      case 'stablecoin':
        return (
          <CurrencyCircleDollarIcon size={ICON_MD} className={colorClass} weight={selected ? 'duotone' : 'regular'} />
        );
      case 'crypto':
        return isBitcoin ? (
          <CurrencyBtcIcon size={ICON_MD} className={colorClass} weight={selected ? 'duotone' : 'regular'} />
        ) : (
          <CurrencyEthIcon size={ICON_MD} className={colorClass} weight={selected ? 'duotone' : 'regular'} />
        );
    }
  };

  const amountPlaceholder = isShareToken ? '0' : '0.00';
  const addressPlaceholder = getAddressPlaceholder(chainShortCode);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Send"
      size="md"
      showFooter
      showCancelButton
      cancelLabel={onBack ? 'Back' : 'Cancel'}
      onCancel={onBack ?? onClose}
      confirmLabel="Continue"
      confirmDisabled={!canTransfer}
      onConfirm={handleConfirm}
    >
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm text-text-primary">
          <ChainIcon size={ICON_MD} className="flex-shrink-0 text-text-muted" />
          <span className="font-mono">{displayAddress}</span>
        </p>

        {isLoadingAssets ? (
          <div className="flex items-center py-2">
            <ArrowsClockwiseIcon size={ICON_LG} className="animate-spin text-text-muted" />
            <span className="ml-2 text-sm text-text-muted">Loading assets...</span>
          </div>
        ) : assets.length === 0 ? (
          <p className="text-sm text-text-muted">No assets in this wallet</p>
        ) : (
          <div className="space-y-2">
            {hasShareTokens && !isSenderWhitelisted && senderWhitelistStatus !== undefined && (
              <p className="flex items-start gap-2 text-sm text-warning-light">
                <ShieldWarningIcon size={ICON_SM} className="mt-0.5 flex-shrink-0" />
                <span>
                  {isSenderWhitelistUnknown
                    ? 'We could not reach the network to check your allowlist status. Transfers of tokenized assets are held until the check succeeds - please try again shortly.'
                    : 'Your wallet is not whitelisted. The operator must whitelist it before you can transfer tokenized assets.'}
                </span>
              </p>
            )}

            <div className="divide-y divide-border-subtle">
              {assets.map((asset) => {
                const isSelected = selectedAsset?.id === asset.id;
                const marketValue = parseFiatValue(asset.marketValue);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      setChosenAsset(asset);
                      onAssetChange?.(asset);
                      setAmount('');
                    }}
                    className="flex w-full items-center justify-between py-2.5 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {getAssetIcon(asset, isSelected)}
                      <span className={`text-sm font-medium ${isSelected ? 'text-brand-light' : 'text-text-primary'}`}>
                        {asset.symbol}
                      </span>
                      {asset.company && (
                        <span className="min-w-0 break-words text-xs text-text-muted">{asset.company}</span>
                      )}
                    </div>
                    <span className="flex items-center gap-1.5">
                      {asset.type === 'crypto' && (
                        <>
                          <span className="text-xs text-text-muted">
                            {asset.displayBalance} {asset.symbol}
                          </span>
                          <span className="text-xs text-text-subtle">&middot;</span>
                        </>
                      )}
                      <span className={`text-sm font-medium ${isSelected ? 'text-brand-light' : 'text-text-primary'}`}>
                        {marketValue === null ? 'Unpriced' : formatDisplayCurrency(marketValue)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-text-primary">Destination Address</label>
            <button
              type="button"
              onClick={() => setShowAddressScanner(!showAddressScanner)}
              className="flex items-center gap-1 text-xs text-brand-mid hover:text-brand-light transition-colors"
            >
              <QrCodeIcon size={ICON_SM} />
              <span>{showAddressScanner ? 'Hide' : 'Scan QR'}</span>
            </button>
          </div>
          {showAddressScanner ? (
            <div className="space-y-2">
              <QRScannerView
                scannerId="send-form-address-scanner"
                error={scannerError}
                className="relative overflow-hidden rounded-lg bg-black mx-auto [&_video]:!object-cover [&_video]:!h-full [&_video]:!w-full"
                style={{ width: 220, height: 220 }}
              />
              <p className="text-xs text-text-muted text-center">Scan address QR code</p>
            </div>
          ) : (
            <input
              type="text"
              value={toAddress}
              onChange={(e) => handleAddressChange(e.target.value)}
              placeholder={addressPlaceholder}
              className={`${FIELD_CLASS} font-mono`}
            />
          )}
          {toAddress && !isValidAddress && (
            <p className="text-xs text-warning-light">
              Please enter a valid {getBlockchainDisplayName(chainShortCode)} address
            </p>
          )}
        </div>

        {isShareToken && isValidAddress && (
          <div className="flex items-center gap-2">
            {isCheckingRecipientWhitelist ? (
              <span className="flex items-center gap-1 text-xs text-text-muted">
                <ArrowsClockwiseIcon size={ICON_XS} className="animate-spin" />
                Checking whitelist...
              </span>
            ) : isRecipientWhitelisted ? (
              <span className="flex items-center gap-1 text-xs text-text-muted">
                <ShieldCheckIcon size={ICON_SM} />
                Recipient is whitelisted
              </span>
            ) : isRecipientWhitelistUnknown ? (
              <span className="flex items-center gap-1 text-xs text-warning-light">
                <ShieldWarningIcon size={ICON_SM} />
                Allowlist status unavailable
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-error-light">
                <ShieldWarningIcon size={ICON_SM} />
                Recipient is not whitelisted
              </span>
            )}
          </div>
        )}

        {isShareToken && isValidAddress && !isRecipientWhitelisted && recipientWhitelistStatus !== undefined && (
          <p
            className={`flex items-start gap-2 text-sm ${isRecipientWhitelistUnknown ? 'text-warning-light' : 'text-error-light'}`}
          >
            <ShieldWarningIcon size={ICON_SM} className="mt-0.5 flex-shrink-0" />
            <span>
              {isRecipientWhitelistUnknown
                ? 'We could not reach the network to check the recipient allowlist status. The transfer is held until the check succeeds - please try again shortly.'
                : 'The recipient address is not whitelisted. The operator must whitelist it before it can receive tokenized assets.'}
            </span>
          </p>
        )}

        {selectedAsset && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-primary">Amount ({selectedAsset.symbol})</label>
            <input
              type="text"
              value={amount}
              onChange={handleAmountChange}
              placeholder={amountPlaceholder}
              className={FIELD_CLASS}
            />
            {parseFiatValue(selectedAsset.marketValue) === null && (
              <p className="text-xs text-text-muted">Unpriced: no fiat estimate available.</p>
            )}
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-muted">
                Max: {selectedAsset.displayBalance} {selectedAsset.symbol}
                {isShareToken && ' (whole numbers only)'}
              </p>
              <button
                type="button"
                onClick={handleUseMax}
                className="text-xs text-brand-mid hover:text-brand-light font-medium"
              >
                Use Max
              </button>
            </div>
            {amount && !isValidAmount && parsedAmount > parsedBalance && (
              <p className="text-xs text-error-light">Amount exceeds available balance</p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

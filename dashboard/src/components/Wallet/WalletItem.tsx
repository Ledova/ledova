import { HardDriveIcon, CloudIcon, ClockIcon } from '@phosphor-icons/react';
import {
  formatCryptoBalance,
  formatSyncAge,
  WALLET_SIGNING_PREFERENCE,
  getWalletSigningPreferenceLabel,
  DESIGN_TOKENS,
  useCurrency,
} from '@ledova/shared';
import type { Wallet } from '@ledova/shared';
import { WalletBadge } from './WalletBadge';

const ICON_XS = DESIGN_TOKENS.icon.sizes.xs;

interface WalletItemProps {
  wallet: Wallet;
  isSelected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
}

export function WalletItem({ wallet, isSelected, onSelect, onEdit }: WalletItemProps) {
  const { formatDisplayCurrency } = useCurrency();
  const secondaryLabel = wallet.name || wallet.address;
  const isHardware = wallet.signingPreference === WALLET_SIGNING_PREFERENCE.HARDWARE;
  const TypeIcon = isHardware ? HardDriveIcon : CloudIcon;
  const syncAge = formatSyncAge(wallet.lastSyncedAt);

  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onEdit}
      aria-pressed={isSelected}
      className={`w-full flex flex-wrap items-center gap-x-3 gap-y-2 px-2 py-4 border-b border-border-subtle transition-colors text-left ${
        isSelected ? 'bg-brand-mid/10 hover:bg-brand-mid/15' : 'hover:bg-surface-tertiary'
      }`}
    >
      <WalletBadge verificationStatus={wallet.verificationStatus} />
      <span className="min-w-0 flex-1 text-sm text-text-primary break-all">{secondaryLabel}</span>
      {wallet.name && <span className="order-3 w-full break-all text-xs text-text-muted">{wallet.address}</span>}
      {wallet.signingPreference && (
        <span
          title={getWalletSigningPreferenceLabel(wallet.signingPreference)}
          aria-label={getWalletSigningPreferenceLabel(wallet.signingPreference)}
          className="inline-flex items-center justify-center p-1"
        >
          <TypeIcon size={ICON_XS} weight="bold" className="text-text-secondary" />
        </span>
      )}
      {syncAge && (
        <span
          className="inline-flex items-center gap-0.5 text-xs text-text-subtle flex-shrink-0"
          title={`Last synced: ${wallet.lastSyncedAt}`}
        >
          <ClockIcon size={ICON_XS} />
          {syncAge}
        </span>
      )}
      <span className="text-xs text-text-muted break-all">
        {formatCryptoBalance(wallet.nativeBalance, '').trimEnd()}
      </span>
      <span className="text-xs text-text-muted break-all">
        {formatDisplayCurrency(parseFloat(wallet.marketValue) || 0)}
      </span>
    </button>
  );
}

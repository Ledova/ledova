import { HardDriveIcon, CloudIcon, ClockIcon } from '@phosphor-icons/react';
import {
  formatCryptoBalance,
  formatSyncAge,
  formatWalletAddressShort,
  getNativeAssetSymbol,
  WALLET_SIGNING_PREFERENCE,
  getWalletSigningPreferenceLabel,
  DESIGN_TOKENS,
  useCurrency,
} from '@ledova/shared';
import type { Wallet } from '@ledova/shared';
import { WalletBadge } from './WalletBadge';

const ICON_XS = DESIGN_TOKENS.icon.sizes.xs;

interface WalletSummaryProps {
  wallet: Wallet;
  compact?: boolean;
}

export function WalletSummary({ wallet, compact = false }: WalletSummaryProps) {
  const { formatDisplayCurrency } = useCurrency();
  const TypeIcon = wallet.signingPreference === WALLET_SIGNING_PREFERENCE.HARDWARE ? HardDriveIcon : CloudIcon;
  const syncAge = formatSyncAge(wallet.lastSyncedAt);

  return (
    <span className="flex min-w-0 flex-1 items-start gap-3">
      <span className="mt-0.5 shrink-0">
        <WalletBadge verificationStatus={wallet.verificationStatus} />
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <span className="min-w-0 flex-1 basis-56">
          <span className="block break-all text-sm font-medium text-text-primary group-hover:text-brand-mid">
            {wallet.name || (compact ? formatWalletAddressShort(wallet.address) : wallet.address)}
          </span>
          {wallet.name && !compact && <span className="block break-all text-xs text-text-muted">{wallet.address}</span>}
          {(wallet.signingPreference || syncAge) && (
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-subtle">
              {wallet.signingPreference && (
                <span
                  role="img"
                  title={getWalletSigningPreferenceLabel(wallet.signingPreference)}
                  aria-label={getWalletSigningPreferenceLabel(wallet.signingPreference)}
                  className="inline-flex items-center"
                >
                  <TypeIcon aria-hidden size={ICON_XS} weight="bold" className="text-text-secondary" />
                </span>
              )}
              {syncAge && (
                <span className="inline-flex items-center gap-0.5" title={`Last synced: ${wallet.lastSyncedAt}`}>
                  <ClockIcon aria-hidden size={ICON_XS} />
                  {syncAge}
                </span>
              )}
            </span>
          )}
        </span>
        <span className="grid shrink-0 grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
          <span className="text-text-muted">Balance</span>
          <span className="break-all text-right tabular-nums text-text-primary">
            {formatCryptoBalance(wallet.nativeBalance, getNativeAssetSymbol(wallet.chain))}
          </span>
          <span className="text-text-muted">Value</span>
          <span className="break-all text-right tabular-nums text-text-primary">
            {formatDisplayCurrency(parseFloat(wallet.marketValue) || 0)}
          </span>
        </span>
      </span>
    </span>
  );
}

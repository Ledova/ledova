import type { ReactNode } from 'react';
import { HardDriveIcon, CloudIcon, ClockIcon } from '@phosphor-icons/react';
import {
  formatCryptoBalance,
  formatSyncAge,
  getNativeAssetSymbol,
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
  children?: ReactNode;
}

export function WalletItem({ wallet, children }: WalletItemProps) {
  const { formatDisplayCurrency } = useCurrency();
  const isHardware = wallet.signingPreference === WALLET_SIGNING_PREFERENCE.HARDWARE;
  const TypeIcon = isHardware ? HardDriveIcon : CloudIcon;
  const syncAge = formatSyncAge(wallet.lastSyncedAt);

  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          <WalletBadge verificationStatus={wallet.verificationStatus} />
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <div className="min-w-0 flex-1 basis-56">
            <p className="break-all text-sm font-medium text-text-primary">{wallet.name || wallet.address}</p>
            {wallet.name && <p className="break-all text-xs text-text-muted">{wallet.address}</p>}
            {(wallet.signingPreference || syncAge) && (
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-subtle">
                {wallet.signingPreference && (
                  <span
                    title={getWalletSigningPreferenceLabel(wallet.signingPreference)}
                    aria-label={getWalletSigningPreferenceLabel(wallet.signingPreference)}
                    className="inline-flex items-center"
                  >
                    <TypeIcon size={ICON_XS} weight="bold" className="text-text-secondary" />
                  </span>
                )}
                {syncAge && (
                  <span className="inline-flex items-center gap-0.5" title={`Last synced: ${wallet.lastSyncedAt}`}>
                    <ClockIcon size={ICON_XS} />
                    {syncAge}
                  </span>
                )}
              </p>
            )}
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-text-muted">Balance</dt>
            <dd className="break-all text-right tabular-nums text-text-primary">
              {formatCryptoBalance(wallet.nativeBalance, getNativeAssetSymbol(wallet.chain))}
            </dd>
            <dt className="text-text-muted">Value</dt>
            <dd className="break-all text-right tabular-nums text-text-primary">
              {formatDisplayCurrency(parseFloat(wallet.marketValue) || 0)}
            </dd>
          </dl>
        </div>
      </div>
      {children && <div className="flex flex-col gap-3 sm:pl-7">{children}</div>}
    </div>
  );
}

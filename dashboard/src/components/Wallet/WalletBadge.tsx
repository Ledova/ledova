import { WalletIcon, CheckCircleIcon, ClockIcon } from '@phosphor-icons/react';
import { WALLET_VERIFICATION_STATUS } from '@ledova/shared';
import { ICON_XS, ICON_SM } from '@components/iconSizes';

interface WalletBadgeProps {
  verificationStatus: string;
}

export function WalletBadge({ verificationStatus }: WalletBadgeProps) {
  const isVerified = verificationStatus === WALLET_VERIFICATION_STATUS.VERIFIED;

  return (
    <span
      role="img"
      className="relative inline-flex"
      aria-label={isVerified ? 'Wallet address verified' : 'Wallet address verification pending'}
    >
      <WalletIcon aria-hidden size={ICON_SM} className={isVerified ? 'text-success-light' : 'text-text-muted'} />
      {isVerified ? (
        <CheckCircleIcon
          aria-hidden
          size={ICON_XS}
          weight="fill"
          className="absolute -bottom-0.5 -right-0.5 text-success-light"
        />
      ) : (
        <ClockIcon
          aria-hidden
          size={ICON_XS}
          weight="fill"
          className="absolute -bottom-0.5 -right-0.5 text-warning-light"
        />
      )}
    </span>
  );
}

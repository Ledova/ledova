import type { ReactNode } from 'react';
import type { Wallet } from '@ledova/shared';
import { WalletSummary } from '@components/wallet/WalletSummary';

interface WalletItemProps {
  wallet: Wallet;
  children?: ReactNode;
}

export function WalletItem({ wallet, children }: WalletItemProps) {
  return (
    <div className="flex flex-col gap-3 py-4">
      <WalletSummary wallet={wallet} />
      {children && <div className="flex flex-col gap-3 sm:pl-7">{children}</div>}
    </div>
  );
}

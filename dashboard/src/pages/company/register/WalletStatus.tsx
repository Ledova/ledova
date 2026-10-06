import { HOLDER_TYPE_LABELS, REGISTER_LINK_COPY, type RegisterWaitingWallets } from '@ledova/shared';

type Statuses = Pick<RegisterWaitingWallets['wallets'][number], 'walletProof' | 'holderType' | 'holderName'>;

export function WalletStatus({ wallet }: { wallet: Statuses }) {
  if (!wallet.walletProof) return <p className="text-xs text-text-muted">{REGISTER_LINK_COPY.NO_STATUS}</p>;
  const holder = wallet.holderName || (wallet.holderType && HOLDER_TYPE_LABELS[wallet.holderType]);
  return (
    <>
      <p className="text-xs text-text-muted">{REGISTER_LINK_COPY.WALLET_PROOF[wallet.walletProof]}</p>
      {holder && (
        <p className="text-xs text-text-muted">
          {REGISTER_LINK_COPY.HOLDER}: {holder}
        </p>
      )}
    </>
  );
}

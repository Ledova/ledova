import { WALLET_VERIFICATION_STATUS, getChainConfig } from '@ledova/shared';
import type { Wallet } from '@ledova/shared';
import { PageAction } from '@components/Page';
import { useBuyCrypto } from '@hooks/useBuyCrypto';
import { useSendTransfer } from '@hooks/useSendTransfer';

export function CryptoActions({ wallets }: { wallets: Wallet[] | null }) {
  const { openBuyCrypto } = useBuyCrypto();
  const { openSendTransfer, openSendTransferFrom } = useSendTransfer();
  const verified = (wallets ?? []).filter(
    (wallet) =>
      getChainConfig(wallet.chain)?.isActive && wallet.verificationStatus === WALLET_VERIFICATION_STATUS.VERIFIED,
  );
  const onlyVerified = verified.length === 1 ? verified[0] : null;

  return (
    <>
      <PageAction label="Buy crypto" onClick={openBuyCrypto} />
      <PageAction
        label="Send"
        onClick={() => (onlyVerified ? openSendTransferFrom(onlyVerified) : openSendTransfer())}
      />
    </>
  );
}

import { PageAction } from '@components/Page';
import { useBuyCrypto } from '@hooks/useBuyCrypto';
import { useSendTransfer } from '@hooks/useSendTransfer';

export function CryptoActions() {
  const { openBuyCrypto } = useBuyCrypto();
  const { openSendTransfer } = useSendTransfer();

  return (
    <>
      <PageAction label="Buy crypto" onClick={openBuyCrypto} />
      <PageAction label="Send" onClick={openSendTransfer} />
    </>
  );
}

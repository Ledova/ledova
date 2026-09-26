import { CurrencyCircleDollarIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { DESIGN_TOKENS } from '@ledova/shared';
import { PageAction } from '@components/Page';
import { useBuyCrypto } from '@hooks/useBuyCrypto';
import { useSendTransfer } from '@hooks/useSendTransfer';

const ICON_SM = DESIGN_TOKENS.icon.sizes.sm;

export function CryptoActions() {
  const { openBuyCrypto } = useBuyCrypto();
  const { openSendTransfer } = useSendTransfer();

  return (
    <>
      <PageAction icon={<CurrencyCircleDollarIcon size={ICON_SM} />} label="Buy crypto" onClick={openBuyCrypto} />
      <PageAction icon={<PaperPlaneTiltIcon size={ICON_SM} />} label="Send" onClick={openSendTransfer} />
    </>
  );
}

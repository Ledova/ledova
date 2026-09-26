import { CurrencyCircleDollarIcon, PaperPlaneTiltIcon } from '@phosphor-icons/react';
import { DESIGN_TOKENS } from '@ledova/shared';
import { useBuyCrypto } from '@hooks/useBuyCrypto';
import { useSendTransfer } from '@hooks/useSendTransfer';

const ICON_SM = DESIGN_TOKENS.icon.sizes.sm;

const ACTION_CLASS =
  'inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-tertiary transition-colors';

export function CryptoActions() {
  const { openBuyCrypto } = useBuyCrypto();
  const { openSendTransfer } = useSendTransfer();

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={() => openBuyCrypto()} className={ACTION_CLASS}>
        <CurrencyCircleDollarIcon size={ICON_SM} />
        <span>Buy crypto</span>
      </button>
      <button type="button" onClick={openSendTransfer} className={ACTION_CLASS}>
        <PaperPlaneTiltIcon size={ICON_SM} />
        <span>Send</span>
      </button>
    </div>
  );
}

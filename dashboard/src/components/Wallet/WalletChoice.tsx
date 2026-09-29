import { SpinnerGapIcon } from '@phosphor-icons/react';
import { ICON_SM } from '@components/iconSizes';
import type { Wallet } from '@ledova/shared';
import { WalletSummary } from './WalletSummary';

interface WalletChoiceProps {
  wallet: Wallet;
  onChoose: () => void;
  disabled?: boolean;
  busy?: boolean;
}

export function WalletChoice({ wallet, onChoose, disabled = false, busy = false }: WalletChoiceProps) {
  return (
    <button
      type="button"
      onClick={onChoose}
      disabled={disabled}
      aria-busy={busy || undefined}
      className="group flex w-full items-start gap-3 py-3 text-left disabled:cursor-not-allowed disabled:opacity-50"
    >
      <WalletSummary wallet={wallet} compact />
      {busy && <SpinnerGapIcon size={ICON_SM} className="mt-0.5 shrink-0 animate-spin text-brand-mid" />}
    </button>
  );
}

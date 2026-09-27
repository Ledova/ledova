import { formatDate, getBlockchainDisplayName, getChainShortCode } from '@ledova/shared';
import type { Transaction } from '@ledova/shared';
import { Status } from '@components/Ledger';
import { activityAmount, activityDirection, activityState } from '../presentation';

interface TransactionListItemProps {
  transaction: Transaction;
  onClick: (transaction: Transaction) => void;
}

export function TransactionListItem({ transaction, onClick }: TransactionListItemProps) {
  const state = activityState(transaction);
  return (
    <button
      type="button"
      onClick={() => onClick(transaction)}
      className="flex w-full flex-wrap items-start justify-between gap-3 py-4 text-left transition-colors hover:bg-surface-tertiary"
    >
      <span className="min-w-0 flex-1 basis-48">
        <span className="block break-words text-sm font-medium text-text-primary">
          {activityDirection(transaction)} · {transaction.assetName || transaction.assetSymbol || 'Asset unavailable'}
        </span>
        <span className="mt-1 block text-sm text-text-muted">
          {getBlockchainDisplayName(getChainShortCode(transaction.chain))} ·{' '}
          {formatDate(transaction.blockTimestamp ?? transaction.createdAt)}
        </span>
        <span className="mt-1 block text-sm text-text-muted">
          <Status tone={state.tone}>{state.label}</Status>
        </span>
      </span>
      <span className="max-w-full break-all text-sm tabular-nums text-text-primary">
        {activityAmount(transaction.amount, transaction.assetSymbol)}
      </span>
    </button>
  );
}

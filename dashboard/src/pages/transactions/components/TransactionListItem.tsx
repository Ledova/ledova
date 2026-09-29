import { formatDate, getBlockchainDisplayName, getChainShortCode } from '@ledova/shared';
import type { Transaction } from '@ledova/shared';
import { Disclosure, Status } from '@components/Ledger';
import { activityAmount, activityDirection, activityState } from '../presentation';
import { TransactionDetail } from './TransactionDetail';

interface TransactionListItemProps {
  transaction: Transaction;
  open: boolean;
  onToggle: (transaction: Transaction) => void;
}

export function TransactionListItem({ transaction, open, onToggle }: TransactionListItemProps) {
  const state = activityState(transaction);
  return (
    <Disclosure
      open={open}
      onToggle={() => onToggle(transaction)}
      summary={
        <span className="flex flex-wrap items-start justify-between gap-3">
          <span className="min-w-0 flex-1 basis-40">
            <span className="block break-words text-sm font-medium text-text-primary">
              {activityDirection(transaction)} ·{' '}
              {transaction.assetName || transaction.assetSymbol || 'Asset unavailable'}
            </span>
            <span className="mt-1 block text-sm text-text-muted">
              {getBlockchainDisplayName(getChainShortCode(transaction.chain))} ·{' '}
              {formatDate(transaction.blockTimestamp ?? transaction.createdAt)}
            </span>
            <span className="mt-1 block text-sm text-text-muted">
              <Status tone={state.tone} mark={state.mark}>
                {state.label}
              </Status>
            </span>
          </span>
          <span className="max-w-full break-all text-sm tabular-nums text-text-primary">
            {activityAmount(transaction.amount, transaction.assetSymbol)}
          </span>
        </span>
      }
    >
      <TransactionDetail transaction={transaction} />
    </Disclosure>
  );
}

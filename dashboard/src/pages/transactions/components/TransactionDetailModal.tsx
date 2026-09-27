import { formatDate, formatTime, getChainShortCode, getBlockchainDisplayName } from '@ledova/shared';
import type { Transaction } from '@ledova/shared';
import { Modal } from '@components/Modal';
import { Row, Rows, Status } from '@components/Ledger';
import { activityAmount, activityDirection, activityState, feeUnit } from '../presentation';

interface TransactionDetailModalProps {
  isOpen: boolean;
  transaction: Transaction | null;
  onClose: () => void;
  onViewExplorer: () => void;
}

export function TransactionDetailModal({ isOpen, transaction, onClose, onViewExplorer }: TransactionDetailModalProps) {
  if (!transaction) return null;
  const state = activityState(transaction);
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Activity detail"
      showFooter
      cancelLabel="Close"
      confirmLabel="View on Explorer"
      onConfirm={transaction.txHash ? onViewExplorer : undefined}
    >
      <Rows>
        <Row label="Direction">{activityDirection(transaction)}</Row>
        <Row label="Status">
          <Status tone={state.tone}>{state.label}</Status>
        </Row>
        <Row label="Asset">
          <span className="break-words">{transaction.assetName || transaction.assetSymbol || 'Unavailable'}</span>
        </Row>
        <Row label="Amount">
          <span className="break-all">{activityAmount(transaction.amount, transaction.assetSymbol)}</span>
        </Row>
        <Row label="Network">{getBlockchainDisplayName(getChainShortCode(transaction.chain))}</Row>
        <Row label="Recorded">
          {formatDate(transaction.createdAt)} {formatTime(transaction.createdAt)}
        </Row>
        {transaction.blockTimestamp && (
          <Row label="Block time">
            {formatDate(transaction.blockTimestamp)} {formatTime(transaction.blockTimestamp)}
          </Row>
        )}
        {transaction.transactionFee !== null && (
          <Row label="Network fee">
            <span className="break-all">{activityAmount(transaction.transactionFee, feeUnit(transaction.chain))}</span>
          </Row>
        )}
        <Row label="Wallet">
          <span className="break-all">{transaction.walletAddress}</span>
        </Row>
        <Row label="From">
          <span className="break-all">{transaction.fromAddress}</span>
        </Row>
        <Row label="To">
          <span className="break-all">{transaction.toAddress ?? 'Unavailable'}</span>
        </Row>
        {transaction.txHash && (
          <Row label="Transaction">
            <span className="break-all">{transaction.txHash}</span>
          </Row>
        )}
      </Rows>
    </Modal>
  );
}

import {
  activityAmount,
  activityDirection,
  feeUnit,
  formatDate,
  formatTime,
  getBlockExplorerTxUrl,
  getBlockchainDisplayName,
  getChainShortCode,
} from '@ledova/shared';
import type { Transaction } from '@ledova/shared';
import { Row, Rows, Status } from '@components/Ledger';
import { activityState } from '../presentation';

export function TransactionDetail({ transaction }: { transaction: Transaction }) {
  const state = activityState(transaction);
  const explorerUrl = transaction.txHash ? getBlockExplorerTxUrl(transaction.chain, transaction.txHash) : '';
  return (
    <>
      <Rows>
        <Row label="Direction">{activityDirection(transaction)}</Row>
        <Row label="Status">
          <Status tone={state.tone} mark={state.mark}>
            {state.label}
          </Status>
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
      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-sm text-brand-light underline"
        >
          View on Explorer
        </a>
      )}
    </>
  );
}

import { useState } from 'react';
import { Linking, Text } from 'react-native';
import {
  activityAmount,
  activityDirection,
  feeUnit,
  formatDate,
  formatTime,
  getChainShortCode,
  getBlockchainDisplayName,
  getTransactionStatus,
  getBlockExplorerTxUrl,
} from '@ledova/shared';
import type { Transaction } from '@ledova/shared';
import { Action, Row, Rows } from '../../../components/Ledger';
import { useThemedStyles } from '../../../contexts';
import { CustomModal } from '../../../components/modal';

export function TransactionDetailModal({
  visible,
  transaction,
  onClose,
}: {
  visible: boolean;
  transaction: Transaction | null;
  onClose: () => void;
}) {
  const [failedHash, setFailedHash] = useState<string | null>(null);
  const styles = useThemedStyles((theme) => ({
    error: { fontFamily: theme.fontFamily.regular, fontSize: theme.fontSize.sm, color: theme.colors.status.error.text },
  }));
  if (!transaction) return null;
  const url = transaction.txHash ? getBlockExplorerTxUrl(transaction.chain, transaction.txHash) : '';
  const openExplorer = async () => {
    setFailedHash(null);
    try {
      await Linking.openURL(url);
    } catch {
      setFailedHash(transaction.txHash);
    }
  };
  return (
    <CustomModal
      visible={visible}
      title="Activity detail"
      onClose={onClose}
      showFooter
      cancelLabel="Close"
      actions={url ? <Action label="View on Explorer" onPress={() => void openExplorer()} /> : undefined}
    >
      <Rows>
        <Row label="Direction">{activityDirection(transaction)}</Row>
        <Row label="Status">{getTransactionStatus(transaction.status).label}</Row>
        <Row label="Asset">{transaction.assetName || transaction.assetSymbol || 'Unavailable'}</Row>
        <Row label="Amount">{activityAmount(transaction.amount, transaction.assetSymbol)}</Row>
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
          <Row label="Network fee">{activityAmount(transaction.transactionFee, feeUnit(transaction.chain))}</Row>
        )}
        <Row label="Wallet">{transaction.walletAddress}</Row>
        <Row label="From">{transaction.fromAddress}</Row>
        <Row label="To">{transaction.toAddress ?? 'Unavailable'}</Row>
        {transaction.txHash && <Row label="Transaction">{transaction.txHash}</Row>}
      </Rows>
      {failedHash === transaction.txHash && (
        <Text accessibilityRole="alert" style={styles.error}>
          The explorer could not be opened. Try again.
        </Text>
      )}
    </CustomModal>
  );
}

import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import {
  activityAmount,
  activityDirection,
  activityStatus,
  feeUnit,
  formatDate,
  formatTime,
  getChainShortCode,
  getBlockchainDisplayName,
  getBlockExplorerTxUrl,
  type Transaction,
} from '@ledova/shared';
import { Action, Row, Rows } from '../../../components/Ledger';
import { useThemedStyles } from '../../../contexts';

export function TransactionDetail({ transaction }: { transaction: Transaction }) {
  const [failedHash, setFailedHash] = useState<string | null>(null);
  const styles = useThemedStyles((theme) => ({
    detail: { gap: theme.spacing.md },
    error: { fontFamily: theme.fontFamily.regular, fontSize: theme.fontSize.sm, color: theme.colors.status.error.text },
  }));
  const status = activityStatus(transaction);
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
    <View style={styles.detail}>
      <Rows>
        <Row label="Direction">{activityDirection(transaction)}</Row>
        <Row label="Status" accessibilityLabel={status.label}>
          {status.text}
        </Row>
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
      {!!url && <Action label="View on Explorer" onPress={() => void openExplorer()} />}
    </View>
  );
}

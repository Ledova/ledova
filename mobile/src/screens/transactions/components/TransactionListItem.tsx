import { Text, View } from 'react-native';
import {
  activityAmount,
  activityDirection,
  formatDate,
  getBlockchainDisplayName,
  getChainShortCode,
  getTransactionStatus,
  type Transaction,
} from '@ledova/shared';
import { Disclosure } from '../../../components/Ledger';
import { useThemedStyles } from '../../../contexts';
import { TransactionDetail } from './TransactionDetail';

export function TransactionListItem({
  transaction,
  open,
  onToggle,
}: {
  transaction: Transaction;
  open: boolean;
  onToggle: (transaction: Transaction) => void;
}) {
  const styles = useThemedStyles((theme) => ({
    row: { borderBottomWidth: 1, borderBottomColor: theme.colors.border.default },
    summary: { gap: 8 },
    title: { fontFamily: theme.fontFamily.medium, fontSize: 17, color: theme.colors.text.primary },
    detail: { fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.muted },
    amount: { fontFamily: theme.fontFamily.medium, fontSize: 18, color: theme.colors.text.primary },
  }));
  return (
    <View style={styles.row}>
      <Disclosure
        open={open}
        onToggle={() => onToggle(transaction)}
        summary={
          <View style={styles.summary}>
            <Text style={styles.title}>
              {activityDirection(transaction)} ·{' '}
              {transaction.assetName || transaction.assetSymbol || 'Asset unavailable'}
            </Text>
            <View>
              <Text style={styles.detail}>
                {getBlockchainDisplayName(getChainShortCode(transaction.chain))} ·{' '}
                {formatDate(transaction.blockTimestamp ?? transaction.createdAt)}
              </Text>
            </View>
            <Text style={styles.detail}>{getTransactionStatus(transaction.status).label}</Text>
            <Text style={styles.amount}>{activityAmount(transaction.amount, transaction.assetSymbol)}</Text>
          </View>
        }
      >
        <TransactionDetail transaction={transaction} />
      </Disclosure>
    </View>
  );
}

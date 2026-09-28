import { Pressable, Text, View } from 'react-native';
import { formatDate, getBlockchainDisplayName, getChainShortCode, getTransactionStatus } from '@ledova/shared';
import type { Transaction } from '@ledova/shared';
import { useThemedStyles } from '../../../contexts';
import { activityAmount, activityDirection } from '../presentation';

export function TransactionListItem({
  transaction,
  onPress,
}: {
  transaction: Transaction;
  onPress: (transaction: Transaction) => void;
}) {
  const styles = useThemedStyles((theme) => ({
    row: { paddingVertical: 18, gap: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border.default },
    title: { fontFamily: theme.fontFamily.medium, fontSize: 17, color: theme.colors.text.primary },
    detail: { fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.muted },
    amount: { fontFamily: theme.fontFamily.medium, fontSize: 18, color: theme.colors.text.primary },
  }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open activity ${transaction.uuid}`}
      onPress={() => onPress(transaction)}
      style={styles.row}
    >
      <Text style={styles.title}>
        {activityDirection(transaction)} · {transaction.assetName || transaction.assetSymbol || 'Asset unavailable'}
      </Text>
      <View>
        <Text style={styles.detail}>
          {getBlockchainDisplayName(getChainShortCode(transaction.chain))} ·{' '}
          {formatDate(transaction.blockTimestamp ?? transaction.createdAt)}
        </Text>
      </View>
      <Text style={styles.detail}>{getTransactionStatus(transaction.status).label}</Text>
      <Text style={styles.amount}>{activityAmount(transaction.amount, transaction.assetSymbol)}</Text>
    </Pressable>
  );
}

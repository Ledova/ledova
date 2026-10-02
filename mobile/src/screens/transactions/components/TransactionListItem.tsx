import { Text, View } from 'react-native';
import {
  activityAmount,
  activityDirection,
  activityStatus,
  formatDate,
  getBlockchainDisplayName,
  getChainShortCode,
  shownSymbol,
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
  const asset = transaction.assetName || transaction.assetSymbol || 'Asset unavailable';
  const heading = `${activityDirection(transaction)} · ${asset}`;
  const network = getBlockchainDisplayName(getChainShortCode(transaction.chain));
  const context = `${network} · ${formatDate(transaction.blockTimestamp ?? transaction.createdAt)}`;
  const status = activityStatus(transaction);
  const amount = activityAmount(transaction.amount, shownSymbol(transaction));
  return (
    <View style={styles.row}>
      <Disclosure
        open={open}
        onToggle={() => onToggle(transaction)}
        accessibilityLabel={[heading, context, status.label, amount].join(', ')}
        summary={
          <View style={styles.summary}>
            <Text style={styles.title}>{heading}</Text>
            <View>
              <Text style={styles.detail}>{context}</Text>
            </View>
            <Text style={styles.detail}>{status.text}</Text>
            <Text style={styles.amount}>{amount}</Text>
          </View>
        }
      >
        <TransactionDetail transaction={transaction} />
      </Disclosure>
    </View>
  );
}

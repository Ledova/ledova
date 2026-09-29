import { Text, View } from 'react-native';
import { formatDateTime, type TransferOrder } from '@ledova/shared';
import { CustomModal } from '../../../components/modal';
import { Action, Row, Rows } from '../../../components/Ledger';
import { marketAmount, marketQuantity } from '../marketData';
import { useMarketStyles } from '../styles';

interface OrderDetailModalProps {
  visible: boolean;
  onClose: () => void;
  order: TransferOrder | null;
  onModify?: (order: TransferOrder) => void;
  onCancel?: (uuid: string) => void;
  blocked?: boolean;
}

export function OrderDetailModal({ visible, onClose, order, onModify, onCancel, blocked }: OrderDetailModalProps) {
  const styles = useMarketStyles();
  const open = order && ['open', 'partially_filled'].includes(order.status);
  return (
    <CustomModal
      visible={visible}
      title="Order details"
      onClose={onClose}
      actions={
        open && (
          <>
            {onModify && <Action label="Modify Order" disabled={blocked} onPress={() => onModify(order)} />}
            {onCancel && <Action label="Cancel Order" disabled={blocked} onPress={() => onCancel(order.uuid)} />}
          </>
        )
      }
    >
      {!order ? (
        <Text accessibilityRole="alert" style={styles.error}>
          This order is unavailable. Refresh your orders to retry.
        </Text>
      ) : (
        <View style={styles.fields}>
          <Text style={styles.text}>{order.tokenName ?? order.tokenSymbol ?? 'Share class unavailable'}</Text>
          {blocked && (
            <Text accessibilityRole="alert" style={styles.error}>
              Waiting for current order and wallet details.
            </Text>
          )}
          <Rows>
            <Row label="Order">{order.orderType === 'buy' ? 'Wanted' : 'For sale'}</Row>
            <Row label="Status">{order.statusDisplay ?? order.status.replace(/_/g, ' ')}</Row>
            <Row label="Price per share">{marketAmount(order.pricePerShare)}</Row>
            <Row label="Total quantity">{marketQuantity(order.quantity)}</Row>
            <Row label="Minimum fill">{order.minQuantity == null ? 'None' : marketQuantity(order.minQuantity)}</Row>
            <Row label="Filled">{marketQuantity(order.filledQuantity ?? 0)}</Row>
            <Row label="Remaining">
              {order.remainingQuantity == null ? 'Unavailable' : marketQuantity(order.remainingQuantity)}
            </Row>
            <Row label="Total value">{marketAmount(order.pricePerShare, order.quantity)}</Row>
            <Row label="Wallet">{order.walletAddress}</Row>
            <Row label="Order ID">{order.uuid}</Row>
            <Row label="Created">{formatDateTime(order.createdAt)}</Row>
          </Rows>
        </View>
      )}
    </CustomModal>
  );
}

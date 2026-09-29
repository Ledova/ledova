import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import {
  formatDateTime,
  marketAmount,
  marketQuantity,
  selectSwapSettlement,
  type Wallet,
  type OrderSubmissionOwner,
  type TransferOrder,
  type SwapOrder,
  type OrderBook,
  type OrderBookEntry,
} from '@ledova/shared';
import { Action, Row, Rows, Section } from '../../../components/Ledger';
import { useMarketStyles } from '../styles';

function BookSide({ title, entries }: { title: string; entries: OrderBookEntry[] }) {
  const styles = useMarketStyles();
  return (
    <View style={styles.fields}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {entries.length === 0 ? (
        <Text style={styles.muted}>No orders listed.</Text>
      ) : (
        <Rows>
          {entries.map((entry, index) => (
            <View key={index} style={styles.classRow}>
              <Rows>
                <Row label="Price per share">{marketAmount(entry.price)}</Row>
                <Row label="Shares">{marketQuantity(entry.quantity)}</Row>
                <Row label="Total">{marketAmount(entry.price, entry.quantity)}</Row>
              </Rows>
            </View>
          ))}
        </Rows>
      )}
    </View>
  );
}

interface OrdersCardProps {
  tokenSymbol: string | null;
  orderBook: OrderBook | null;
  isLoadingOrderBook: boolean;
  orderBookError?: unknown;
  onRefreshBook?: () => void;
  userOrders: TransferOrder[];
  isLoadingUserOrders: boolean;
  ordersError?: unknown;
  onRefreshOrders?: () => void;
  onCancelOrder: (uuid: string) => void;
  onEditOrder: (order: TransferOrder) => void;
  onViewOrder: (order: TransferOrder) => void;
  swaps: SwapOrder[] | undefined;
  isLoadingSwaps: boolean;
  swapsError?: unknown;
  onRefreshSwaps?: () => void;
  wallets: Wallet[];
  settlementOwner: OrderSubmissionOwner | null;
  onSignSwap: (swap: SwapOrder) => void;
  ordersBlocked?: boolean;
  swapsBlocked?: boolean;
}

export function OrdersCard({
  tokenSymbol,
  orderBook,
  isLoadingOrderBook,
  orderBookError,
  onRefreshBook,
  userOrders,
  isLoadingUserOrders,
  ordersError,
  onRefreshOrders,
  onCancelOrder,
  onEditOrder,
  onViewOrder,
  swaps,
  isLoadingSwaps,
  swapsError,
  onRefreshSwaps,
  wallets,
  settlementOwner,
  onSignSwap,
  ordersBlocked,
  swapsBlocked,
}: OrdersCardProps) {
  const styles = useMarketStyles();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      {tokenSymbol && (
        <Section title={`Orders for ${tokenSymbol}`}>
          {orderBookError ? (
            <>
              <Text accessibilityRole="alert" style={styles.error}>
                The order lists could not be loaded.
              </Text>
              <Action label="Retry order lists" onPress={() => onRefreshBook?.()} />
            </>
          ) : isLoadingOrderBook ? (
            <ActivityIndicator accessibilityLabel="Loading order lists" />
          ) : (
            <>
              <BookSide title="For sale" entries={orderBook?.sellOrders ?? []} />
              <BookSide title="Wanted" entries={orderBook?.buyOrders ?? []} />
            </>
          )}
        </Section>
      )}
      <Section title="Your orders">
        <Text style={styles.muted}>Your recorded orders remain here when a share class is no longer listed.</Text>
        {ordersError ? (
          <>
            <Text accessibilityRole="alert" style={styles.error}>
              Your orders could not be loaded.
            </Text>
            <Action label="Retry your orders" onPress={() => onRefreshOrders?.()} />
          </>
        ) : isLoadingUserOrders ? (
          <ActivityIndicator accessibilityLabel="Loading your orders" />
        ) : userOrders.length === 0 ? (
          <Text style={styles.muted}>No recorded orders.</Text>
        ) : (
          <Rows>
            {userOrders.map((order) => (
              <View key={order.uuid} style={styles.classRow}>
                <Text style={styles.text}>{order.tokenName ?? order.tokenSymbol ?? 'Share class unavailable'}</Text>
                <Rows>
                  <Row label="Order">{order.orderType === 'buy' ? 'Wanted' : 'For sale'}</Row>
                  <Row label="Status">{order.statusDisplay ?? order.status.replace(/_/g, ' ')}</Row>
                  <Row label="Shares remaining">{marketQuantity(order.remainingQuantity ?? order.quantity)}</Row>
                  <Row label="Price per share">{marketAmount(order.pricePerShare)}</Row>
                  <Row label="Remaining value">
                    {marketAmount(order.pricePerShare, order.remainingQuantity ?? order.quantity)}
                  </Row>
                  <Row label="Created">{formatDateTime(order.createdAt)}</Row>
                  <Row label="Wallet">{order.walletAddress}</Row>
                </Rows>
                <View style={styles.actions}>
                  <Action
                    label="Details"
                    accessibilityLabel={`Details for order ${order.uuid}`}
                    onPress={() => onViewOrder(order)}
                    disabled={ordersBlocked}
                  />
                  {['open', 'partially_filled'].includes(order.status) &&
                    (confirming === order.uuid ? (
                      <>
                        <Text style={styles.text}>Cancel this order?</Text>
                        <Action
                          label="Yes, cancel"
                          disabled={ordersBlocked}
                          onPress={() => {
                            onCancelOrder(order.uuid);
                            setConfirming(null);
                          }}
                        />
                        <Action label="Keep order" onPress={() => setConfirming(null)} />
                      </>
                    ) : (
                      <>
                        <Action
                          label="Modify"
                          accessibilityLabel={`Modify order ${order.uuid}`}
                          disabled={ordersBlocked}
                          onPress={() => onEditOrder(order)}
                        />
                        <Action
                          label="Cancel order"
                          accessibilityLabel={`Cancel order ${order.uuid}`}
                          disabled={ordersBlocked}
                          onPress={() => setConfirming(order.uuid)}
                        />
                      </>
                    ))}
                </View>
              </View>
            ))}
          </Rows>
        )}
      </Section>
      <Section title="Trades awaiting signatures">
        {swapsError ? (
          <>
            <Text accessibilityRole="alert" style={styles.error}>
              Trades could not be loaded.
            </Text>
            <Action label="Retry trades" onPress={() => onRefreshSwaps?.()} />
          </>
        ) : isLoadingSwaps ? (
          <ActivityIndicator accessibilityLabel="Loading trades" />
        ) : !swaps?.length ? (
          <Text style={styles.muted}>No trades awaiting signatures for your verified wallets.</Text>
        ) : (
          <Rows>
            {swaps.map((swap) => {
              const legacy = swap.settlementProtocolVersion === 0;
              let canReview = false;
              let role = wallets.some((wallet) => wallet.address.toLowerCase() === swap.sellerAddress.toLowerCase())
                ? 'Seller'
                : wallets.some((wallet) => wallet.address.toLowerCase() === swap.buyerAddress.toLowerCase())
                  ? 'Buyer'
                  : 'Unavailable';
              if (!legacy && settlementOwner && ['created', 'seller_signed', 'buyer_signed'].includes(swap.status)) {
                try {
                  const { selection } = selectSwapSettlement(swap, settlementOwner, wallets);
                  role = selection.orderUuid === swap.sellOrderUuid ? 'Seller' : 'Buyer';
                  canReview = true;
                } catch {
                  canReview = false;
                }
              }
              return (
                <View key={swap.uuid} style={styles.classRow}>
                  <Text style={styles.text}>
                    {swap.shareTokenName ?? swap.shareTokenSymbol ?? 'Share class unavailable'}
                  </Text>
                  <Rows>
                    <Row label="Your role">{role}</Row>
                    <Row label="Status">{swap.status.replace(/_/g, ' ')}</Row>
                    {legacy ? (
                      <Row label="Recorded shares">{marketQuantity(swap.shareAmount)} shares</Row>
                    ) : (
                      <Row label="Amounts">Review trade amounts</Row>
                    )}
                    {!legacy && new Date(swap.expiresAt).getTime() <= now && <Row label="Signing window">Expired</Row>}
                    <Row label="Expires">{formatDateTime(swap.expiresAt)}</Row>
                  </Rows>
                  {legacy ? (
                    <Text style={styles.muted}>Held for operator review</Text>
                  ) : canReview ? (
                    <Action
                      label="Review trade and sign"
                      accessibilityLabel="Sign"
                      onPress={() => onSignSwap(swap)}
                      disabled={swapsBlocked}
                    />
                  ) : (
                    <Text style={styles.muted}>No signature is available for the current account and wallets.</Text>
                  )}
                </View>
              );
            })}
          </Rows>
        )}
      </Section>
    </>
  );
}

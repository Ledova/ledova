import { useState } from 'react';
import type { Wallet, OrderSubmissionOwner, TransferOrder, SwapOrder, OrderBook, OrderBookEntry } from '@ledova/shared';
import { selectSwapSettlement, formatDateTime } from '@ledova/shared';
import { Section, Rows, Row, Status } from '@components/Ledger';
import { marketAmount, marketQuantity } from '../marketData';

function BookSide({ title, entries }: { title: string; entries: OrderBookEntry[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-text-primary">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-text-muted">No orders listed.</p>
      ) : (
        entries.map((entry, index) => (
          <div key={index} className="border-b border-border-subtle py-2">
            <Rows>
              <Row label="Price per share">
                <span className="break-all">{marketAmount(entry.price)}</span>
              </Row>
              <Row label="Shares">
                <span className="break-all">{marketQuantity(entry.quantity)}</span>
              </Row>
              <Row label="Total">
                <span className="break-all">{marketAmount(entry.price, entry.quantity)}</span>
              </Row>
            </Rows>
          </div>
        ))
      )}
    </div>
  );
}

interface OrdersPanelProps {
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
  swaps: SwapOrder[] | undefined;
  isLoadingSwaps: boolean;
  swapsError?: unknown;
  onRefreshSwaps?: () => void;
  wallets: Wallet[];
  settlementOwner: OrderSubmissionOwner | null;
  onSignSwap: (swap: SwapOrder) => void;
}

export function OrdersPanel({
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
  swaps,
  isLoadingSwaps,
  swapsError,
  onRefreshSwaps,
  wallets,
  settlementOwner,
  onSignSwap,
}: OrdersPanelProps) {
  const [confirmingOrderId, setConfirmingOrderId] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-8">
      {tokenSymbol && (
        <Section title={`Orders for ${tokenSymbol}`}>
          {orderBookError ? (
            <div role="alert">
              The order lists could not be loaded.{' '}
              <button className="underline" onClick={onRefreshBook}>
                Retry order lists
              </button>
            </div>
          ) : isLoadingOrderBook ? (
            <p role="status">Loading order lists…</p>
          ) : (
            <div className="grid gap-8 md:grid-cols-2">
              <BookSide title="For sale" entries={orderBook?.sellOrders ?? []} />
              <BookSide title="Wanted" entries={orderBook?.buyOrders ?? []} />
            </div>
          )}
        </Section>
      )}
      <Section title="Your orders">
        <p className="text-sm text-text-muted">
          Your recorded orders remain here when a share class is no longer listed.
        </p>
        {ordersError ? (
          <div role="alert">
            Your orders could not be loaded.{' '}
            <button className="underline" onClick={onRefreshOrders}>
              Retry your orders
            </button>
          </div>
        ) : isLoadingUserOrders ? (
          <p role="status">Loading your orders…</p>
        ) : userOrders.length === 0 ? (
          <p className="text-sm text-text-muted">No recorded orders.</p>
        ) : (
          userOrders.map((order) => (
            <article key={order.uuid} className="border-b border-border-subtle py-3">
              <h3 className="break-words font-medium">
                {order.tokenName ?? order.tokenSymbol ?? 'Share class unavailable'}
              </h3>
              <Rows>
                <Row label="Order">
                  <span>{order.orderType === 'buy' ? 'Wanted' : 'For sale'}</span>
                </Row>
                <Row label="Status">
                  <Status
                    tone={
                      order.status === 'completed'
                        ? 'done'
                        : ['cancelled', 'failed', 'expired'].includes(order.status)
                          ? 'closed'
                          : 'waiting'
                    }
                  >
                    {order.statusDisplay ?? order.status.replace(/_/g, ' ')}
                  </Status>
                </Row>
                <Row label="Shares remaining">
                  <span className="break-all">{marketQuantity(order.remainingQuantity ?? order.quantity)}</span>
                </Row>
                <Row label="Price per share">
                  <span className="break-all">{marketAmount(order.pricePerShare)}</span>
                </Row>
                <Row label="Remaining value">
                  <span className="break-all">
                    {marketAmount(order.pricePerShare, order.remainingQuantity ?? order.quantity)}
                  </span>
                </Row>
                <Row label="Created">{formatDateTime(order.createdAt)}</Row>
                <Row label="Wallet">
                  <span className="break-all">{order.walletAddress}</span>
                </Row>
              </Rows>
              {['open', 'partially_filled'].includes(order.status) && (
                <div className="flex flex-wrap items-center gap-4 py-2 text-sm">
                  {confirmingOrderId === order.uuid ? (
                    <>
                      <span>Cancel?</span>
                      <button
                        className="underline"
                        onClick={() => {
                          onCancelOrder(order.uuid);
                          setConfirmingOrderId(null);
                        }}
                      >
                        Yes
                      </button>
                      <button className="underline" onClick={() => setConfirmingOrderId(null)}>
                        No
                      </button>
                    </>
                  ) : (
                    <>
                      <button title="Modify" className="underline" onClick={() => onEditOrder(order)}>
                        Modify
                      </button>
                      <button title="Cancel" className="underline" onClick={() => setConfirmingOrderId(order.uuid)}>
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              )}
            </article>
          ))
        )}
      </Section>
      <Section title="Trades awaiting signatures">
        {swapsError ? (
          <div role="alert">
            Trades could not be loaded.{' '}
            <button className="underline" onClick={onRefreshSwaps}>
              Retry trades
            </button>
          </div>
        ) : isLoadingSwaps ? (
          <p role="status">Loading trades…</p>
        ) : !swaps?.length ? (
          <p className="text-sm text-text-muted">No trades awaiting signatures for your verified wallets.</p>
        ) : (
          swaps.map((swap) => {
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
              <article key={swap.uuid} className="border-b border-border-subtle py-3">
                <h3 className="break-words font-medium">
                  {swap.shareTokenName ?? swap.shareTokenSymbol ?? 'Share class unavailable'}
                </h3>
                <Rows>
                  <Row label="Your role">{role}</Row>
                  <Row label="Status">{swap.status.replace(/_/g, ' ')}</Row>
                  {legacy ? (
                    <Row label="Recorded shares">{marketQuantity(swap.shareAmount)}</Row>
                  ) : (
                    <Row label="Amounts">Review trade amounts</Row>
                  )}
                  {!legacy && new Date(swap.expiresAt).getTime() <= new Date().getTime() && (
                    <Row label="Signing window">Expired</Row>
                  )}
                  <Row label="Expires">{formatDateTime(swap.expiresAt)}</Row>
                </Rows>
                {legacy ? (
                  <p className="text-sm text-text-muted">Held for operator review</p>
                ) : canReview ? (
                  <button title="Sign swap" className="py-2 text-sm underline" onClick={() => onSignSwap(swap)}>
                    Review trade and sign
                  </button>
                ) : (
                  <p className="text-sm text-text-muted">
                    No signature is available for the current account and wallets.
                  </p>
                )}
              </article>
            );
          })
        )}
      </Section>
    </div>
  );
}

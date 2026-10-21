import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { TransferOrder, CreateOrderRequest, Wallet, SwapOrder } from '@ledova/shared';
import {
  marketAmount,
  shareCount,
  selectSwapSettlement,
  useInvestorReadinessQuery,
  useOrderBook,
  useOrderSubmissions,
  useOrderActions,
  useShareTokens,
  useSwapOrdersMulti,
  useSwapSettlements,
} from '@ledova/shared';
import { orderSubmissionStore } from '@services/orderSubmissions';
import { settlementWalletKey, swapSettlementCrypto, swapSettlementStore } from '@services/swapSettlements';
import { isTradingWalletsQueryKey, useTrading, useUserTradingWallets, useWalletsWhitelistStatus } from './useTrading';
import { SwapSettlementFlow } from './SwapSettlementFlow';
import { OrderSigningFlow } from './OrderSigningFlow';
import { OrderActionFlow } from './OrderActionFlow';
import { orderActionStore } from '@services/orderActions';
import { MarketOverview } from './MarketOverview';
import { OrdersPanel } from './OrdersPanel';
import { PlaceOrderPanel } from './PlaceOrderPanel';
import { useTradingEvents } from './useTradingEvents';
import { Page, PageAction } from '@components/Page';
import { Outcome, Section, LoadError } from '@components/Ledger';

function TradingPage() {
  const queryClient = useQueryClient();
  const submissions = useOrderSubmissions(orderSubmissionStore);
  const actions = useOrderActions(orderActionStore);
  const settlements = useSwapSettlements(swapSettlementStore, swapSettlementCrypto);
  const closeSettlement = useRef(settlements.close);
  useLayoutEffect(() => {
    closeSettlement.current = settlements.close;
  }, [settlements.close]);
  const settlementWalletGuard = useRef<{
    walletUuid: string;
    ownerAccountUuid: string;
    key: string;
    retired: boolean;
  } | null>(null);
  const signingGeneration = useRef(0);
  const currentSigningGeneration = signingGeneration.current;
  const tokensQuery = useShareTokens();
  const { data: tokens, isLoading } = tokensQuery;
  const eligibilityQuery = useInvestorReadinessQuery();
  const { data: eligibility } = eligibilityQuery;
  const isReady = eligibility?.isReady ?? false;
  const [selectedTokenUuid, setSelectedTokenUuid] = useState<string | null>(null);

  const [placed, setPlaced] = useState<{ order: TransferOrder; recovered: boolean } | null>(null);

  const [swapSelectionError, setSwapSelectionError] = useState<string | null>(null);

  useTradingEvents(selectedTokenUuid);

  const tradingWallets = useUserTradingWallets();
  const { wallets, actionWallets, walletAddresses } = tradingWallets;
  const latestWallets = useRef(wallets);
  // eslint-disable-next-line react-hooks/refs
  latestWallets.current = wallets;
  useEffect(() => {
    if (settlements.active && !settlements.active.isCurrent()) settlements.close();
  }, [settlements.active, settlements.close, wallets]);
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        const guard = settlementWalletGuard.current;
        const key = event.query.queryKey;
        if (
          !guard ||
          guard.retired ||
          !['updated', 'removed'].includes(event.type) ||
          !isTradingWalletsQueryKey(key, guard.ownerAccountUuid)
        )
          return;
        const data = event.query.state.data as { data?: { results?: Wallet[] } } | undefined;
        const rows = event.type === 'removed' || event.query.state.status === 'error' ? null : data?.data?.results;
        const observed = Array.isArray(rows)
          ? (rows.find((candidate) => candidate.uuid === guard.walletUuid) ?? null)
          : null;
        if (settlementWalletKey(observed) !== guard.key) {
          guard.retired = true;
          closeSettlement.current();
        }
      }),
    [queryClient],
  );
  const swapsQuery = useSwapOrdersMulti(walletAddresses);
  const { data: swaps, isLoading: isLoadingSwaps } = swapsQuery;

  if (tokens && tokens.length > 0 && !selectedTokenUuid) {
    setSelectedTokenUuid(tokens[0].uuid);
  }

  const selectedToken = useMemo(() => {
    if (!tokens || !selectedTokenUuid) return null;
    return tokens.find((t) => t.uuid === selectedTokenUuid) || null;
  }, [tokens, selectedTokenUuid]);
  const { getStatus: getWhitelistStatusFor, isLoading: isLoadingWhitelistStatus } = useWalletsWhitelistStatus(
    selectedToken?.contractAddress ?? undefined,
    walletAddresses,
  );

  const {
    userOrders,
    isLoadingUserOrders,
    isFetchingOrders,
    getWalletsWithHoldings,
    ordersError,
    refreshOrders,
    balancesError,
    isLoadingBalances,
    isFetchingBalances,
    refreshBalances,
  } = useTrading({
    walletAddresses,
  });

  const orderBookQuery = useOrderBook(!tokensQuery.isError ? selectedToken?.uuid : undefined);
  const { data: orderBookData, isLoading: isLoadingOrderBook } = orderBookQuery;
  const readsUnavailable = !!(
    tokensQuery.isError ||
    tradingWallets.error ||
    tokensQuery.isFetching ||
    tradingWallets.isFetching
  );

  const handleCreateOrder = (data: CreateOrderRequest): Promise<boolean> => {
    if (
      readsUnavailable ||
      eligibilityQuery.isError ||
      eligibilityQuery.isFetching ||
      !isReady ||
      !selectedToken ||
      data.token !== selectedToken.uuid
    )
      return Promise.resolve(false);
    setPlaced(null);
    closeSwapSigning();
    actions.close();
    const signingWallet = wallets.find((w) => w.uuid === data.walletUuid);
    return submissions.begin(data, signingWallet ?? null);
  };

  const handleCancelOrder = (uuid: string) => {
    setPlaced(null);
    signingGeneration.current++;
    closeSwapSigning();
    submissions.close();
    actions.open(uuid, 'cancel');
  };

  const handleEditOrder = (order: TransferOrder) => {
    setPlaced(null);
    signingGeneration.current++;
    closeSwapSigning();
    submissions.close();
    actions.open(order.uuid, 'modify');
  };

  const closeSwapSigning = () => {
    if (settlementWalletGuard.current) settlementWalletGuard.current.retired = true;
    settlementWalletGuard.current = null;
    settlements.close();
    setSwapSelectionError(null);
  };

  const walletCurrent = (walletUuid: string) => {
    const selected = latestWallets.current.find((candidate) => candidate.uuid === walletUuid) ?? null;
    const key = settlementWalletKey(selected);
    const guard = { walletUuid, ownerAccountUuid: settlements.owner?.ownerAccountUuid ?? '', key, retired: false };
    settlementWalletGuard.current = guard;
    return () =>
      !guard.retired &&
      settlementWalletGuard.current === guard &&
      key === settlementWalletKey(latestWallets.current.find((candidate) => candidate.uuid === walletUuid) ?? null);
  };

  const handleSignSwap = (swap: SwapOrder) => {
    setPlaced(null);
    signingGeneration.current++;
    submissions.close();
    actions.close();
    closeSwapSigning();
    if (!settlements.owner) return;
    try {
      const { selection, wallet } = selectSwapSettlement(swap, settlements.owner, wallets);
      settlements.open(selection, walletCurrent(wallet.uuid));
    } catch {
      setSwapSelectionError('The trade details did not match the selected account and wallet.');
    }
  };

  const handleCloseOrderSigningFlow = () => {
    signingGeneration.current++;
    submissions.close();
  };

  const handleOrderSigningSuccess = (order: TransferOrder, recovered = false) => {
    if (signingGeneration.current !== currentSigningGeneration) return;
    if (submissions.active) setPlaced({ order, recovered });
    handleCloseOrderSigningFlow();
  };

  const savedWorkAlerts = [submissions.error, actions.error, swapSelectionError, settlements.error].filter(
    (message): message is string => !!message,
  );
  const hasSavedWork =
    submissions.pending.length + actions.pending.length + settlements.pending.length + savedWorkAlerts.length > 0;

  return (
    <Page>
      <MarketOverview
        tokens={tokens || []}
        selectedTokenUuid={selectedTokenUuid}
        onSelectToken={(uuid) => {
          setPlaced(null);
          setSelectedTokenUuid(uuid);
        }}
        isLoading={isLoading || eligibilityQuery.isLoading}
        isReady={isReady}
        error={tokensQuery.error || eligibilityQuery.error}
        isRetrying={tokensQuery.isFetching || eligibilityQuery.isFetching}
        onRetry={() => {
          void tokensQuery.refetch();
          void eligibilityQuery.refetch();
        }}
      />

      {tradingWallets.error && (
        <LoadError retry={() => tradingWallets.refetch()} busy={tradingWallets.isFetching}>
          Wallets could not be loaded. Trading actions are unavailable.
        </LoadError>
      )}
      {placed && (
        <Outcome>
          {placed.order.orderType === 'buy' ? 'Buy' : 'Sell'} order {placed.recovered ? 'recovered' : 'placed'}
          {placed.order.tokenSymbol || placed.order.tokenName
            ? ` for ${placed.order.tokenSymbol || placed.order.tokenName}`
            : ''}
          : {shareCount(placed.order.quantity)} at {marketAmount(placed.order.pricePerShare)},{' '}
          {marketAmount(placed.order.totalValue)} in total.
        </Outcome>
      )}
      <OrdersPanel
        tokenSymbol={!tokensQuery.isError ? (selectedToken?.symbol ?? null) : null}
        orderBook={orderBookData || null}
        isLoadingOrderBook={isLoadingOrderBook}
        orderBookError={orderBookQuery.error}
        onRefreshBook={() => void orderBookQuery.refetch()}
        isRefreshingBook={orderBookQuery.isFetching}
        userOrders={userOrders}
        isLoadingUserOrders={isLoadingUserOrders}
        ordersError={ordersError}
        onRefreshOrders={() => void refreshOrders()}
        isRefreshingOrders={isFetchingOrders}
        onCancelOrder={handleCancelOrder}
        onEditOrder={handleEditOrder}
        swaps={swaps}
        isLoadingSwaps={isLoadingSwaps || tradingWallets.isLoading}
        swapsError={swapsQuery.error || tradingWallets.error}
        onRefreshSwaps={() => {
          void tradingWallets.refetch();
          void swapsQuery.refetch();
        }}
        isRefreshingSwaps={swapsQuery.isFetching || tradingWallets.isFetching}
        wallets={wallets}
        settlementOwner={settlements.owner}
        onSignSwap={handleSignSwap}
      />
      {hasSavedWork && (
        <Section title="Saved work">
          {savedWorkAlerts.map((message) => (
            <p key={message} role="alert" className="text-sm text-error-light">
              {message}
            </p>
          ))}
          {submissions.pending.length > 0 && (
            <>
              <p className="text-sm text-text-muted">
                Check unfinished orders here. New buy and sell orders are separate orders, even with the same terms.
              </p>
              <div className="flex flex-wrap gap-2">
                {submissions.pending.map((record, index) => {
                  const walletName = wallets.find((wallet) => wallet.uuid === record.walletUuid)?.name;
                  return (
                    <PageAction
                      key={record.submissionId}
                      label={`Check saved order ${index + 1}${walletName ? ` — ${walletName}` : ''}`}
                      onClick={() => {
                        signingGeneration.current++;
                        closeSwapSigning();
                        actions.close();
                        setPlaced(null);
                        submissions.recover(record);
                      }}
                    />
                  );
                })}
              </div>
            </>
          )}
          {actions.pending.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actions.pending.map((record, index) => (
                <PageAction
                  key={record.actionId}
                  label={`Check ${record.purpose === 'cancel' ? 'cancellation' : 'change'} ${index + 1}`}
                  onClick={() => {
                    signingGeneration.current++;
                    closeSwapSigning();
                    submissions.close();
                    setPlaced(null);
                    actions.recover(record);
                  }}
                />
              ))}
            </div>
          )}
          {settlements.pending.length > 0 && (
            <>
              <p className="text-sm text-text-muted">
                Check the original trade after a lost connection or interrupted signing.
              </p>
              <div className="flex flex-wrap gap-2">
                {settlements.pending.map((record, index) => (
                  <PageAction
                    key={`${record.orderUuid}/${record.swapUuid}/${record.walletUuid}/${record.settlementDigest}/${record.kind}/${record.kind === 'approval' ? record.txHash : record.signerAddress}`}
                    label={`Check saved ${record.kind === 'approval' ? 'approval' : 'trade signature'} ${index + 1}`}
                    onClick={() => {
                      signingGeneration.current++;
                      submissions.close();
                      actions.close();
                      closeSwapSigning();
                      setPlaced(null);
                      settlements.recover(record, walletCurrent(record.walletUuid));
                    }}
                  />
                ))}
              </div>
            </>
          )}
          <PageAction
            label="Refresh saved work"
            busy={submissions.isLoading || actions.isLoading || settlements.isLoading}
            busyLabel="Refreshing…"
            onClick={() => {
              void submissions.refresh();
              void actions.refresh();
              void settlements.refresh();
            }}
          />
        </Section>
      )}
      {selectedToken && (
        <>
          {balancesError && (
            <LoadError retry={refreshBalances} busy={isFetchingBalances}>
              Share balances could not be loaded. Selling is unavailable.
            </LoadError>
          )}
          <PlaceOrderPanel
            token={selectedToken}
            wallets={wallets}
            walletsWithHoldings={balancesError || isLoadingBalances ? [] : getWalletsWithHoldings(selectedToken.uuid)}
            readsUnavailable={readsUnavailable}
            getWalletWhitelistStatus={getWhitelistStatusFor}
            onSubmit={handleCreateOrder}
            onNewOrder={handleCloseOrderSigningFlow}
            onDismiss={handleCloseOrderSigningFlow}
            submissionError={submissions.error}
            isLoadingWhitelistStatus={isLoadingWhitelistStatus}
          />
        </>
      )}

      {settlements.active && (
        <SwapSettlementFlow settlement={settlements.active} wallets={wallets} onClose={closeSwapSigning} />
      )}

      <OrderSigningFlow
        isOpen={!!submissions.active}
        onClose={handleCloseOrderSigningFlow}
        submission={submissions.active}
        tokens={tokens ?? []}
        wallet={wallets.find((wallet) => wallet.uuid === submissions.active?.record.walletUuid) ?? null}
        onSuccess={handleOrderSigningSuccess}
      />
      {actions.active && (
        <OrderActionFlow
          key={actions.active.record?.actionId ?? `${actions.active.orderUuid}/${actions.active.purpose}`}
          action={actions.active}
          wallets={actionWallets}
          onClose={actions.close}
        />
      )}
    </Page>
  );
}

export default TradingPage;

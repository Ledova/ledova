import React, { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { View, Text, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient, type QueryCacheNotifyEvent } from '@tanstack/react-query';
import type { ShareToken, TransferOrder, CreateOrderRequest, SwapOrder, Wallet } from '@ledova/shared';
import {
  selectSwapSettlement,
  useInvestorEligibilityQuery,
  useOrderBook,
  useOrderSubmissions,
  useOrderActions,
  useShareTokens,
  useSwapOrdersMulti,
  useSwapSettlements,
  type SavedSwapSettlement,
} from '@ledova/shared';
import { settlementWalletMaterial, swapSettlementCrypto, swapSettlementStore } from '../../services/swapSettlements';
import { SwapSettlementModal } from './components/SwapSettlementModal';
import { orderSubmissionSession, orderSubmissionStore } from '../../services/orderSubmissions';
import { Action, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useMarketStyles } from './styles';
import {
  useUserTradingWallets,
  useWalletsWhitelistStatus,
  useAllWalletTokenBalances,
  useAllUserOrders,
} from './useTrading';
import { useTradingEvents } from './hooks/useTradingEvents';
import { MarketList } from './components/MarketList';
import { OrdersCard } from './components/OrdersCard';
import { BuySellButtons } from './components/BuySellButtons';
import { CreateOrderModal } from './components/CreateOrderModal';
import { OrderSigningModal } from './components/OrderSigningModal';
import { OrderActionModal } from './components/OrderActionModal';
import { orderActionStore } from '../../services/orderActions';
import { useAppTheme } from '../../contexts';

export function TradingScreen() {
  const submissions = useOrderSubmissions(orderSubmissionStore, orderSubmissionSession);
  const actions = useOrderActions(orderActionStore, orderSubmissionSession);
  const queryClient = useQueryClient();
  const walletObserver = useRef<((event: QueryCacheNotifyEvent) => void) | null>(null);
  useEffect(() => queryClient.getQueryCache().subscribe((event) => walletObserver.current?.(event)), [queryClient]);
  const settlements = useSwapSettlements(swapSettlementStore, swapSettlementCrypto, orderSubmissionSession);
  const settlementGeneration = useRef(0);
  // eslint-disable-next-line react-hooks/refs
  const currentSettlementGeneration = settlementGeneration.current;
  const settlementScreen = useRef({ focused: true, close: () => {} });
  useLayoutEffect(() => {
    settlementScreen.current.close = settlements.close;
  }, [settlements.close]);
  useFocusEffect(
    useCallback(() => {
      settlementScreen.current.focused = true;
      return () => {
        settlementScreen.current.focused = false;
        settlementGeneration.current++;
        settlementScreen.current.close();
      };
    }, []),
  );
  const signingGeneration = useRef(0);
  const currentSigningGeneration = signingGeneration.current;
  const theme = useAppTheme();
  const styles = useMarketStyles();

  const [refreshing, setRefreshing] = useState(false);
  const [selectedTokenUuid, setSelectedTokenUuid] = useState<string | null>(null);

  const tokensQuery = useShareTokens();
  const tokens = tokensQuery.isError ? [] : (tokensQuery.data ?? []);
  const eligibilityQuery = useInvestorEligibilityQuery();
  const isEligible = !eligibilityQuery.isError && !!eligibilityQuery.data?.isEligible;
  const tradingWallets = useUserTradingWallets();
  const { wallets, actionWallets, walletAddresses } = tradingWallets;
  const currentWallets = useRef(wallets);
  // eslint-disable-next-line react-hooks/refs
  currentWallets.current = wallets;
  settlements.active?.isCurrent();
  const tokenBalances = useAllWalletTokenBalances(walletAddresses);
  const userOrders = useAllUserOrders();
  const swapOrders = useSwapOrdersMulti(walletAddresses);

  const effectiveTokenUuid = selectedTokenUuid ?? (tokens && tokens.length > 0 ? tokens[0].uuid : null);

  useTradingEvents(effectiveTokenUuid);

  const selectedToken = useMemo(() => {
    if (!tokens || !effectiveTokenUuid) return null;
    return tokens.find((t: ShareToken) => t.uuid === effectiveTokenUuid) || null;
  }, [tokens, effectiveTokenUuid]);
  const [draftToken, setDraftToken] = useState<ShareToken | null>(null);
  const whitelistStatus = useWalletsWhitelistStatus(
    (draftToken ?? selectedToken)?.contractAddress ?? undefined,
    walletAddresses,
  );

  const orderBook = useOrderBook(selectedToken?.uuid);
  const walletReadsBlocked = !!(tradingWallets.error || tradingWallets.isLoading || tradingWallets.isFetching);
  const newOrdersBlocked =
    walletReadsBlocked ||
    !!(
      tokensQuery.isError ||
      tokensQuery.isLoading ||
      tokensQuery.isFetching ||
      eligibilityQuery.isError ||
      eligibilityQuery.isFetching ||
      !isEligible
    );
  const ordersBlocked = walletReadsBlocked || !!(userOrders.error || userOrders.isFetching);
  const swapsBlocked = walletReadsBlocked || !!(swapOrders.isError || swapOrders.isFetching);

  const [createOrderType, setCreateOrderType] = useState<'buy' | 'sell'>('buy');
  const [showCreateOrder, setShowCreateOrder] = useState(false);

  const [settlementError, setSettlementError] = useState<string | null>(null);
  const closeSettlement = () => {
    settlementGeneration.current++;
    settlements.close();
    walletObserver.current = null;
  };
  const walletBoundary = (wallet: Wallet) => {
    const material = settlementWalletMaterial(wallet);
    let retired = false;
    walletObserver.current = (event) => {
      const key = event.query.queryKey;
      if (key[0] !== 'wallets' || key[1] !== wallet.userAccount || key[2] !== 'trading') return;
      const data = event.query.state.data as { data: { results: Wallet[] } } | undefined;
      const current =
        event.type === 'removed' || event.query.state.status === 'error'
          ? undefined
          : data?.data?.results?.find((item) => item.uuid === wallet.uuid);
      if (material !== settlementWalletMaterial(current)) retired = true;
    };
    return () =>
      !retired &&
      settlementScreen.current.focused &&
      material === settlementWalletMaterial(currentWallets.current.find((item) => item.uuid === wallet.uuid));
  };
  const recoverSettlement = (record: SavedSwapSettlement) => {
    if (walletReadsBlocked) return;
    closeSettlement();
    const wallet = wallets.find(
      (item) => item.uuid === record.walletUuid && item.userAccount === record.ownerAccountUuid,
    );
    if (!wallet) {
      setSettlementError('The original wallet is unavailable in this account. The saved settlement remains.');
      return;
    }
    setSettlementError(null);
    submissions.close();
    actions.close();
    settlements.recover(record, walletBoundary(wallet));
  };

  const handleBuy = () => {
    if (newOrdersBlocked || !selectedToken) return;
    setDraftToken(selectedToken);
    closeSettlement();
    signingGeneration.current++;
    submissions.close();
    actions.close();
    setCreateOrderType('buy');
    setShowCreateOrder(true);
  };

  const handleSell = () => {
    if (newOrdersBlocked || !selectedToken) return;
    setDraftToken(selectedToken);
    closeSettlement();
    signingGeneration.current++;
    submissions.close();
    actions.close();
    setCreateOrderType('sell');
    setShowCreateOrder(true);
  };

  const handleCreateOrderSubmit = async (data: CreateOrderRequest): Promise<boolean> => {
    if (
      newOrdersBlocked ||
      !selectedToken ||
      data.token !== selectedToken.uuid ||
      whitelistStatus.isLoading ||
      !whitelistStatus.isWhitelisted(data.walletAddress) ||
      (data.orderType === 'sell' && (tokenBalances.error || tokenBalances.isLoading))
    )
      return false;
    const generation = signingGeneration.current;
    const accepted = await submissions.begin(data, wallets.find((wallet) => wallet.uuid === data.walletUuid) ?? null);
    if (accepted && generation === signingGeneration.current) {
      setShowCreateOrder(false);
      setDraftToken(null);
    }
    return accepted;
  };

  const handleCancelOrder = (orderUuid: string) => {
    if (ordersBlocked) return;
    closeSettlement();
    signingGeneration.current++;
    submissions.close();
    setShowCreateOrder(false);
    actions.open(orderUuid, 'cancel');
  };

  const handleEditOrder = (order: TransferOrder) => {
    if (ordersBlocked) return;
    closeSettlement();
    signingGeneration.current++;
    submissions.close();
    setShowCreateOrder(false);
    actions.open(order.uuid, 'modify');
  };

  const handleSignSwap = (swap: SwapOrder) => {
    if (swapsBlocked) return;
    closeSettlement();
    setSettlementError(null);
    submissions.close();
    actions.close();
    setShowCreateOrder(false);
    try {
      if (!settlements.owner) throw new Error('No current account.');
      const { selection, wallet } = selectSwapSettlement(swap, settlements.owner, wallets);
      settlements.open(selection, walletBoundary(wallet));
    } catch {
      setSettlementError('This settlement cannot be opened with the current account and wallet.');
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        tokensQuery.refetch(),
        eligibilityQuery.refetch(),
        tradingWallets.refetch(),
        userOrders.refetch(),
        tokenBalances.refetch(),
        whitelistStatus.refetch(),
        swapOrders.refetch(),
        orderBook.refetch(),
        submissions.refresh(),
        actions.refresh(),
        settlements.refresh(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSigningSuccess = () => {
    if (signingGeneration.current !== currentSigningGeneration) return;
    userOrders.refetch();
    tokenBalances.refetch();
  };

  const walletsWithHoldings = useMemo(() => {
    if (!selectedToken) return [];
    return tokenBalances.getWalletsWithHoldings(selectedToken.uuid);
  }, [selectedToken, tokenBalances]);

  const handleSelectToken = useCallback((uuid: string) => {
    setSelectedTokenUuid(uuid);
  }, []);

  const savedWorkAlerts = [submissions.error, actions.error, settlementError || settlements.error].filter(
    (message): message is string => !!message,
  );
  const hasSavedWork =
    submissions.pending.length + actions.pending.length + settlements.pending.length + savedWorkAlerts.length > 0;

  return (
    <View style={styles.page}>
      <Page
        testID="market-screen"
        title="Market"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.interactive.default}
          />
        }
      >
        {(eligibilityQuery.isError || tradingWallets.error) && (
          <Section title="Trading details unavailable">
            <Text accessibilityRole="alert" style={styles.error}>
              {eligibilityQuery.isError ? 'Eligibility could not be loaded.' : 'Wallets could not be loaded.'}
            </Text>
            <Action label="Retry trading details" onPress={() => void handleRefresh()} />
          </Section>
        )}
        <MarketList
          tokens={tokens || []}
          selectedTokenUuid={effectiveTokenUuid}
          onSelectToken={handleSelectToken}
          isLoading={tokensQuery.isLoading || eligibilityQuery.isLoading}
          isEligible={isEligible}
          error={tokensQuery.error || eligibilityQuery.error}
          onRetry={() => void handleRefresh()}
          disabled={showCreateOrder || newOrdersBlocked}
        />

        {selectedToken && (
          <BuySellButtons
            tokenSymbol={selectedToken.symbol}
            onBuy={handleBuy}
            onSell={handleSell}
            disabled={newOrdersBlocked || wallets.length === 0 || showCreateOrder}
          />
        )}

        <OrdersCard
          tokenSymbol={selectedToken?.symbol ?? null}
          orderBook={orderBook.isError ? null : (orderBook.data ?? null)}
          isLoadingOrderBook={orderBook.isLoading}
          orderBookError={orderBook.error}
          onRefreshBook={() => void orderBook.refetch()}
          userOrders={userOrders.orders}
          isLoadingUserOrders={userOrders.isLoading}
          ordersError={userOrders.error}
          onRefreshOrders={() => void userOrders.refetch()}
          ordersBlocked={ordersBlocked}
          onCancelOrder={handleCancelOrder}
          onEditOrder={handleEditOrder}
          swaps={swapOrders.isError ? [] : swapOrders.data}
          isLoadingSwaps={swapOrders.isLoading}
          swapsError={swapOrders.error || tradingWallets.error}
          onRefreshSwaps={() => void handleRefresh()}
          swapsBlocked={swapsBlocked}
          wallets={wallets}
          settlementOwner={settlements.owner}
          onSignSwap={handleSignSwap}
        />

        {hasSavedWork && (
          <Section title="Saved work">
            {savedWorkAlerts.map((message) => (
              <Text key={message} accessibilityRole="alert" style={styles.error}>
                {message}
              </Text>
            ))}
            {submissions.pending.length > 0 && (
              <>
                <Text style={styles.muted}>
                  Check unfinished orders here. New buy and sell orders are separate orders, even with the same terms.
                </Text>
                {submissions.pending.map((record, index) => (
                  <Action
                    key={record.submissionId}
                    label={`Check saved order ${index + 1}`}
                    onPress={() => {
                      signingGeneration.current++;
                      closeSettlement();
                      actions.close();
                      submissions.recover(record);
                    }}
                  />
                ))}
              </>
            )}
            {actions.pending.map((record, index) => (
              <Action
                key={record.actionId}
                label={`Check ${record.purpose === 'cancel' ? 'cancellation' : 'change'} ${index + 1}`}
                onPress={() => {
                  signingGeneration.current++;
                  closeSettlement();
                  submissions.close();
                  setShowCreateOrder(false);
                  actions.recover(record);
                }}
              />
            ))}
            {settlements.pending.length > 0 && (
              <>
                <Text style={styles.muted}>
                  Check signatures and original approval transactions whose outcome is still unconfirmed.
                </Text>
                {settlements.pending.map((record, index) => (
                  <View
                    key={`${record.swapUuid}/${record.walletUuid}/${record.kind}/${record.kind === 'approval' ? record.txHash : record.signerAddress}`}
                    style={styles.fields}
                  >
                    <Action label={`Check saved settlement ${index + 1}`} onPress={() => recoverSettlement(record)} />
                    {record.kind === 'approval' && (
                      <Text selectable style={styles.muted}>
                        Unconfirmed approval: {record.txHash}
                      </Text>
                    )}
                  </View>
                ))}
              </>
            )}
            <Action
              label="Refresh saved work"
              disabled={submissions.isLoading || actions.isLoading || settlements.isLoading}
              onPress={() => {
                void submissions.refresh();
                void actions.refresh();
                void settlements.refresh();
              }}
            />
          </Section>
        )}
      </Page>

      {draftToken && (
        <CreateOrderModal
          visible={showCreateOrder}
          onClose={() => {
            signingGeneration.current++;
            submissions.close();
            setShowCreateOrder(false);
            setDraftToken(null);
          }}
          token={draftToken}
          orderType={createOrderType}
          wallets={wallets}
          walletsWithHoldings={walletsWithHoldings}
          onSubmit={handleCreateOrderSubmit}
          submissionError={submissions.error}
          isWalletWhitelisted={whitelistStatus.isWhitelisted}
          getWhitelistStatus={whitelistStatus.getStatus}
          isLoadingWhitelistStatus={whitelistStatus.isLoading}
          blocked={
            newOrdersBlocked ||
            !selectedToken ||
            selectedToken.uuid !== draftToken.uuid ||
            (createOrderType === 'sell' && !!(tokenBalances.error || tokenBalances.isLoading))
          }
          onRetry={() => void handleRefresh()}
        />
      )}

      <OrderSigningModal
        visible={!!submissions.active}
        onClose={() => {
          signingGeneration.current++;
          submissions.close();
        }}
        submission={submissions.active}
        tokens={tokens ?? []}
        wallet={wallets.find((wallet) => wallet.uuid === submissions.active?.record.walletUuid) ?? null}
        onSuccess={handleSigningSuccess}
      />

      {actions.active && (
        <OrderActionModal
          key={`${actions.active.orderUuid}/${actions.active.purpose}`}
          action={actions.active}
          wallets={actionWallets}
          onClose={actions.close}
        />
      )}

      {settlements.active && (
        <SwapSettlementModal
          key={`${settlements.active.selection.swapUuid}/${currentSettlementGeneration}`}
          settlement={settlements.active}
          wallet={wallets.find((item) => item.uuid === settlements.active?.selection.walletUuid) ?? null}
          onClose={() => {
            if (settlementGeneration.current === currentSettlementGeneration) closeSettlement();
          }}
        />
      )}
    </View>
  );
}

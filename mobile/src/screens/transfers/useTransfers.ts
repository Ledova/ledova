import { useState, useCallback, useEffect, useMemo } from 'react';
import { Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AxiosResponse } from 'axios';
import {
  getWallets,
  prepareTransfer,
  prepareBitcoinTransfer,
  broadcastTransfer,
  getWalletHoldings,
  CACHE_TIMING,
  getBlockchainDisplayName,
  getChainShortCode,
  getNativeAssetSymbol,
  getEstimatedFee,
  isBitcoinChain,
  isSupportedEvmChain,
  getChainConfig,
  WALLET_VERIFICATION_STATUS,
  formatPlainDecimal,
  canonicalDecimal,
  getErrorMessage,
  getHoldingTokenDeployment,
  readEveryPage,
  useUserPreferences,
  validatePreparedTransfer,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import type {
  Wallet,
  PrepareTransferRequest,
  PrepareTransferResponse,
  PrepareBitcoinTransferRequest,
  PrepareBitcoinTransferResponse,
  BroadcastTransferRequest,
  TransferState,
  TransactionData,
  TransferableAsset,
  WalletHolding,
} from '@ledova/shared';

type SendState = TransferState & { prepareRefusal: string | null };

const INITIAL_STATE: SendState = {
  step: 'select-wallet',
  wallet: null,
  selectedAsset: null,
  toAddress: '',
  amount: '',
  transactionData: null,
  preparedAsset: null,
  signedTransaction: '',
  txHash: '',
  prepareRefusal: null,
};

function canonicalAmount(prepared: TransactionData | null) {
  const amount = prepared?.amountToken ?? prepared?.amountEth ?? prepared?.amountBtc;
  return amount === undefined ? undefined : canonicalDecimal(amount);
}

function assetKey(asset: TransferableAsset) {
  return asset.contractAddress?.toLowerCase() ?? '';
}

function nativeTransferableAsset(wallet: Wallet): TransferableAsset {
  const chainShortCode = getChainShortCode(wallet.chain);
  return {
    uuid: `native-${wallet.uuid}`,
    symbol: getNativeAssetSymbol(wallet.chain),
    name: isSupportedEvmChain(chainShortCode) ? 'Ether' : getBlockchainDisplayName(chainShortCode),
    balance: wallet.nativeBalance,
    marketValue: wallet.nativeMarketValue,
    isNative: true,
    decimals: isBitcoinChain(chainShortCode) ? 8 : 18,
    chain: wallet.chain,
  };
}

function buildTransferableAssets(wallet: Wallet, holdings: WalletHolding[]): TransferableAsset[] {
  const chain = wallet.chain;
  const assets: TransferableAsset[] = [];

  const nativeBalance = parseFloat(wallet.nativeBalance) || 0;
  if (nativeBalance > 0) assets.push(nativeTransferableAsset(wallet));

  if (isSupportedEvmChain(chain)) {
    for (const holding of holdings) {
      const balance = parseFloat(holding.quantity) || 0;
      const deployment = getHoldingTokenDeployment(holding, wallet);
      if (balance > 0 && deployment?.contractAddress) {
        assets.push({
          uuid: holding.uuid,
          symbol: holding.assetSymbol,
          name: holding.assetName,
          balance: holding.quantity,
          marketValue: holding.marketValue,
          isNative: false,
          contractAddress: deployment.contractAddress,
          decimals: deployment.decimals,
          chain,
        });
      }
    }
  }

  return assets;
}

export function useTransfers(initialWallet: Wallet | null = null) {
  const queryClient = useQueryClient();
  const account = useUserPreferences();
  const { userAccount } = account;
  const [state, setState] = useState<SendState>(() =>
    initialWallet ? { ...INITIAL_STATE, step: 'enter-details', wallet: initialWallet } : INITIAL_STATE,
  );
  const [pendingBroadcast, setPendingBroadcast] = useState(false);

  const walletsQuery = useQuery({
    queryKey: ['wallets', userAccount?.uuid],
    queryFn: () => readEveryPage((page) => getWallets(apiClient, { page })),
    enabled: !!userAccount?.uuid,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
  });

  const holdingsQuery = useQuery({
    queryKey: ['wallet-holdings', state.wallet?.uuid],
    queryFn: () => getWalletHoldings(apiClient, state.wallet!.uuid),
    enabled: !!state.wallet?.uuid,
    staleTime: CACHE_TIMING.DEFAULT_STALE_TIME,
  });

  const holdings = holdingsQuery.data?.data;
  const transferableAssets = useMemo(() => {
    if (!state.wallet) return [];
    return holdings ? buildTransferableAssets(state.wallet, holdings) : [nativeTransferableAsset(state.wallet)];
  }, [state.wallet, holdings]);

  useEffect(() => {
    if (!state.wallet) return;
    setState((prev) => {
      const selected = prev.selectedAsset;
      if (selected && transferableAssets.includes(selected)) return prev;
      const kept = selected ? transferableAssets.find((asset) => assetKey(asset) === assetKey(selected)) : undefined;
      if (kept) return { ...prev, selectedAsset: kept };
      return { ...prev, selectedAsset: transferableAssets[0] ?? null, amount: '', prepareRefusal: null };
    });
  }, [state.wallet, state.selectedAsset, transferableAssets]);

  const prepareTransferMutation = useMutation({
    mutationFn: async ({
      uuid,
      data,
      asset,
    }: {
      uuid: string;
      data: PrepareTransferRequest | PrepareBitcoinTransferRequest;
      asset: TransferableAsset;
    }): Promise<AxiosResponse<PrepareTransferResponse | PrepareBitcoinTransferResponse>> => {
      if ('amountBtc' in data) return prepareBitcoinTransfer(apiClient, uuid, data);
      const response = await prepareTransfer(apiClient, uuid, data);
      validatePreparedTransfer(response.data, data, asset.decimals);
      return response;
    },
    onMutate: () => setState((prev) => ({ ...prev, prepareRefusal: null })),
    onError: (error) => setState((prev) => ({ ...prev, prepareRefusal: getErrorMessage(error) })),
    onSuccess: (response, { asset }) => {
      setState((prev) => ({
        ...prev,
        step: 'review',
        transactionData: response.data as unknown as TransactionData,
        preparedAsset: asset,
      }));
    },
  });

  const broadcastTransferMutation = useMutation({
    mutationFn: ({ uuid, data }: { uuid: string; data: BroadcastTransferRequest }) =>
      broadcastTransfer(apiClient, uuid, data),
    onSuccess: (response) => {
      setState((prev) => ({
        ...prev,
        step: 'success',
        txHash: response.data.txHash || '',
      }));
      queryClient.invalidateQueries({ queryKey: ['wallets'] });
    },
  });

  useEffect(() => {
    if (pendingBroadcast && state.signedTransaction && state.wallet && state.step === 'broadcast') {
      setPendingBroadcast(false);

      const chain = getChainShortCode(state.wallet.chain);
      const prepared = state.transactionData;
      const fee = isBitcoinChain(chain) ? prepared?.feeBtc : prepared?.gasCostEth;

      broadcastTransferMutation.mutate({
        uuid: state.wallet.uuid,
        data: {
          signedTransaction: state.signedTransaction,
          toAddress: prepared?.toAddress,
          amount: canonicalAmount(prepared),
          transactionFee: fee,
          tokenContract: state.preparedAsset?.isNative ? undefined : state.preparedAsset?.contractAddress,
        },
      });
    }
  }, [pendingBroadcast, state.signedTransaction, state.wallet, state.step, broadcastTransferMutation]);

  const selectWallet = useCallback((wallet: Wallet) => {
    setState((prev) => ({
      ...prev,
      step: 'enter-details',
      wallet,
      selectedAsset: null,
      amount: '',
      prepareRefusal: null,
    }));
  }, []);

  const selectAsset = useCallback((asset: TransferableAsset) => {
    setState((prev) => ({ ...prev, selectedAsset: asset, amount: '', prepareRefusal: null }));
  }, []);

  const setToAddress = useCallback((toAddress: string) => {
    setState((prev) => ({ ...prev, toAddress, prepareRefusal: null }));
  }, []);

  const setAmount = useCallback((amount: string) => {
    setState((prev) => ({ ...prev, amount, prepareRefusal: null }));
  }, []);

  const useMaxAmount = useCallback(() => {
    if (!state.wallet || !state.selectedAsset) return;

    const balance = parseFloat(state.selectedAsset.balance);
    if (isNaN(balance) || balance <= 0) return;

    const chain = getChainShortCode(state.wallet.chain);
    const symbol = state.selectedAsset.symbol;

    if (state.selectedAsset.isNative) {
      const estimatedFee = getEstimatedFee(chain);
      const maxAmount = balance - estimatedFee;

      if (maxAmount <= 0) {
        Alert.alert(
          'Low Balance Warning',
          `Your balance (${balance.toFixed(8)} ${symbol}) is very low. After estimated gas fees (~${estimatedFee} ${chain}), there may not be enough to transfer. The transaction may fail.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Try Anyway',
              onPress: () => setAmount(formatPlainDecimal(balance * 0.9, 8)),
            },
          ],
        );
        return;
      }

      setAmount(formatPlainDecimal(maxAmount, 8));
    } else {
      setAmount(formatPlainDecimal(balance, Math.min(state.selectedAsset.decimals, 8)));
    }
  }, [state.wallet, state.selectedAsset, setAmount]);

  const submitTransfer = useCallback(() => {
    if (!state.wallet || !state.selectedAsset) return;

    const chain = getChainShortCode(state.wallet.chain);
    let data: PrepareTransferRequest | PrepareBitcoinTransferRequest;

    if (state.selectedAsset.isNative) {
      data = isBitcoinChain(chain)
        ? { toAddress: state.toAddress, amountBtc: state.amount }
        : { toAddress: state.toAddress, amountEth: state.amount };
    } else {
      data = {
        toAddress: state.toAddress,
        amountToken: state.amount,
        tokenContract: state.selectedAsset.contractAddress,
      };
    }

    prepareTransferMutation.mutate({
      uuid: state.wallet.uuid,
      data,
      asset: state.selectedAsset,
    });
  }, [state.wallet, state.selectedAsset, state.toAddress, state.amount, prepareTransferMutation]);

  const proceedToSign = useCallback(() => {
    setState((prev) => ({ ...prev, step: 'sign' }));
  }, []);

  const handleSignature = useCallback((signedTransaction: string) => {
    setPendingBroadcast(true);
    setState((prev) => ({ ...prev, step: 'broadcast', signedTransaction }));
  }, []);

  const backToReview = useCallback(() => {
    setState((prev) => ({ ...prev, step: 'review', signedTransaction: '' }));
  }, []);

  const cancel = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
    setPendingBroadcast(false);
  }, []);

  const preferencesFailed = account.isError || (!!account.preferences && !userAccount?.uuid);
  const wallets = (walletsQuery.data ?? []).filter(
    (w: Wallet) => getChainConfig(w.chain)?.isActive && w.verificationStatus === WALLET_VERIFICATION_STATUS.VERIFIED,
  );

  return {
    step: state.step,
    wallet: state.wallet,
    selectedAsset: state.selectedAsset,
    transferableAssets,
    toAddress: state.toAddress,
    amount: state.amount,
    transactionData: state.transactionData,
    preparedAsset: state.preparedAsset,
    txHash: state.txHash,
    wallets,
    isLoading: walletsQuery.isPending,
    walletsFailed: walletsQuery.isError || preferencesFailed,
    isRetryingWallets: walletsQuery.isFetching || account.isFetching,
    retryWallets: () => void (preferencesFailed ? account.refetch() : walletsQuery.refetch()),
    isLoadingHoldings: holdingsQuery.isLoading,
    isPreparing: prepareTransferMutation.isPending,
    isBroadcasting: broadcastTransferMutation.isPending,
    prepareError: state.prepareRefusal,
    broadcastError: getErrorMessage(broadcastTransferMutation.error),
    selectWallet,
    selectAsset,
    setToAddress,
    setAmount,
    useMaxAmount,
    submitTransfer,
    proceedToSign,
    handleSignature,
    backToReview,
    cancel,
    reset,
  };
}

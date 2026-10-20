import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  apiErrorSentence,
  prepareTransfer,
  prepareBitcoinTransfer,
  broadcastTransfer,
  BLOCKCHAIN,
  canonicalDecimal,
  validatePreparedTransfer,
  WALLETS_QUERY_KEY,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import type { Wallet, PreparedWalletTransfer } from '@ledova/shared';

const PREPARE_FAILED = 'The transfer could not be prepared. Check the details and try again.';
const BROADCAST_FAILED = 'The transaction could not be broadcast. Try again.';

interface UseCryptoTransferSigningParams {
  wallet: Wallet | null;
  toAddress: string;
  amount: string;
  tokenContract?: string;
  decimals?: number;
}

interface UseCryptoTransferSigningResult {
  preparedTransaction: PreparedWalletTransfer | null;
  isPreparing: boolean;
  isBroadcasting: boolean;
  prepareError: string | null;
  broadcastError: string | null;
  prepare: () => void;
  broadcast: (signedTx: string) => Promise<string>;
  reset: () => void;
}

export function useCryptoTransferSigning({
  wallet,
  toAddress,
  amount,
  tokenContract,
  decimals = 18,
}: UseCryptoTransferSigningParams): UseCryptoTransferSigningResult {
  const queryClient = useQueryClient();
  const [preparedTransaction, setPreparedTransaction] = useState<PreparedWalletTransfer | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  const prepareMutation = useMutation({
    mutationFn: async (): Promise<PreparedWalletTransfer> => {
      if (!wallet) throw new Error('No wallet selected');
      if (wallet.chain === BLOCKCHAIN.BITCOIN) {
        const response = await prepareBitcoinTransfer(apiClient, wallet.uuid, { toAddress, amountBtc: amount });
        return response.data;
      }
      const data = tokenContract ? { toAddress, amountToken: amount, tokenContract } : { toAddress, amountEth: amount };
      const response = await prepareTransfer(apiClient, wallet.uuid, data);
      validatePreparedTransfer(response.data, data, decimals);
      return response.data;
    },
    onSuccess: (data) => {
      setPreparedTransaction(data);
      setPrepareError(null);
    },
    onError: (err) => {
      setPrepareError(apiErrorSentence(err, PREPARE_FAILED, PREPARE_FAILED));
      setPreparedTransaction(null);
    },
  });

  const broadcastMutation = useMutation({
    mutationFn: async (signedTx: string) => {
      if (!wallet) throw new Error('No wallet selected');

      const prepared = preparedTransaction;
      const transactionFee = prepared ? ('feeBtc' in prepared ? prepared.feeBtc : prepared.gasCostEth) : undefined;
      const response = await broadcastTransfer(apiClient, wallet.uuid, {
        signedTransaction: signedTx,
        toAddress,
        amount: canonicalDecimal(amount),
        transactionFee,
        tokenContract,
      });
      return response.data;
    },
    onSuccess: () => {
      setBroadcastError(null);
      queryClient.invalidateQueries({ queryKey: WALLETS_QUERY_KEY });
    },
    onError: (err) => {
      setBroadcastError(apiErrorSentence(err, BROADCAST_FAILED, BROADCAST_FAILED));
    },
  });

  const prepare = useCallback(() => {
    setPrepareError(null);
    prepareMutation.mutate();
  }, [prepareMutation]);

  const broadcast = useCallback(
    async (signedTx: string): Promise<string> => {
      const result = await broadcastMutation.mutateAsync(signedTx);
      return result.txHash || '';
    },
    [broadcastMutation],
  );

  const reset = useCallback(() => {
    setPreparedTransaction(null);
    setPrepareError(null);
    setBroadcastError(null);
  }, []);

  return {
    preparedTransaction,
    isPreparing: prepareMutation.isPending,
    isBroadcasting: broadcastMutation.isPending,
    prepareError,
    broadcastError,
    prepare,
    broadcast,
    reset,
  };
}

import type { ApiSchema, ApiRequest, ApiResponse } from '../contracts';
import type { Wallet } from './wallet';

export type PrepareTransferRequest = Omit<ApiRequest<'api_wallets_prepare_transfer_create'>, 'amountBtc'>;

export type PrepareBitcoinTransferRequest = Required<
  Pick<ApiRequest<'api_wallets_prepare_transfer_create'>, 'toAddress' | 'amountBtc'>
>;

export interface TransferableAsset {
  uuid: string;
  symbol: string;
  name: string;
  balance: string;
  marketValue: string | null;
  isNative: boolean;
  contractAddress?: string;
  decimals: number;
  chain: string;
}

export type PrepareTransferResponse = ApiSchema<'PreparedEvmTransfer'>;

export type PrepareBitcoinTransferResponse = ApiSchema<'PreparedBitcoinTransfer'>;

export type PreparedWalletTransfer = ApiResponse<'api_wallets_prepare_transfer_create'>;

export type BroadcastTransferRequest = ApiRequest<'api_wallets_broadcast_transfer_create'>;

export type BroadcastTransferResponse = ApiResponse<'api_wallets_broadcast_transfer_create'>;

export type TransferStepSimple = 'select-wallet' | 'enter-details' | 'review' | 'sign' | 'broadcast' | 'success';

export interface TransactionData {
  transaction: string;
  fromAddress: string;
  toAddress: string;
  amountEth?: string;
  gasCostEth?: string;
  totalCostEth?: string;
  gasPriceGwei?: string;
  gasLimit?: string;
  amountBtc?: string;
  feeBtc?: string;
  totalCostBtc?: string;
  feePerByte?: string;
  estimatedTxSize?: number;
  amountToken?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  tokenContract?: string;
}

export interface TransferState {
  step: TransferStepSimple;
  wallet: Wallet | null;
  selectedAsset: TransferableAsset | null;
  toAddress: string;
  amount: string;
  transactionData: TransactionData | null;
  signedTransaction: string;
  txHash: string;
}

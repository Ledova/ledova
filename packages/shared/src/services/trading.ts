import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { TRADING_ENDPOINTS } from '../constants';
import { failureStatus, hasServiceErrorDetail, failureSentence } from '../utils/errors';
import type {
  ShareToken,
  TransferOrder,
  OrderSubmissionRequest,
  OrderSubmissionSnapshot,
  OrderActionContext,
  OrderActionSnapshot,
  OrderActionRequest,
  OrderActionModificationRequest,
  OrderActionExecuteRequest,
  OrderBook,
  GetOrdersParams,
  WhitelistStatus,
  SignedCreateOrderRequest,
  WalletTokenBalancesResponse,
  PaginatedResponse,
  ApiResponse,
} from '../types';

declare module 'axios' {
  interface AxiosRequestConfig {
    ledovaSubmissionGuard?: () => void;
  }
}

const NOT_ALLOWLISTED =
  'Your wallet is not on the trading allowlist. The operator must add it before you can place orders.';
const NOT_AUTHORISED = 'Your wallet is not authorized to trade. The operator must add it to the trading allowlist.';

export const getShareTokens = (apiClient: AxiosInstance, page?: number) =>
  apiClient.get<PaginatedResponse<ShareToken>>(TRADING_ENDPOINTS.TOKENS.LIST, page ? { params: { page } } : undefined);

export const getOrderBook = (apiClient: AxiosInstance, tokenUuid: string) =>
  apiClient.get<OrderBook>(TRADING_ENDPOINTS.TOKENS.ORDER_BOOK(tokenUuid));

export const getOrders = (apiClient: AxiosInstance, params?: GetOrdersParams) =>
  apiClient.get<PaginatedResponse<TransferOrder>>(TRADING_ENDPOINTS.ORDERS.LIST, { params });

const orderSubmissionBody = (data: OrderSubmissionRequest) => ({
  submission_id: data.submissionId,
  owner_account_uuid: data.ownerAccountUuid,
  token: data.token,
  order_type: data.orderType.toLowerCase(),
  wallet_uuid: data.walletUuid,
  wallet_address: data.walletAddress,
  quantity: data.quantity,
  min_quantity: data.minQuantity ?? 0,
  price_per_share: data.pricePerShare,
});

export const getOrderCreateMessage = (
  apiClient: AxiosInstance,
  data: OrderSubmissionRequest,
  config?: AxiosRequestConfig,
) =>
  apiClient.post<OrderSubmissionSnapshot>(TRADING_ENDPOINTS.ORDERS.CREATE_MESSAGE, orderSubmissionBody(data), config);

export const getOrderSubmission = (
  apiClient: AxiosInstance,
  submissionId: string,
  ownerAccountUuid: string,
  config?: AxiosRequestConfig,
) =>
  apiClient.get<OrderSubmissionSnapshot>(TRADING_ENDPOINTS.ORDERS.SUBMISSION(submissionId), {
    ...config,
    params: { owner_account_uuid: ownerAccountUuid },
  });

export const getOrderActionContext = (
  apiClient: AxiosInstance,
  uuid: string,
  ownerAccountUuid: string,
  config?: AxiosRequestConfig,
) =>
  apiClient.get<OrderActionContext>(TRADING_ENDPOINTS.ORDERS.ACTION_CONTEXT(uuid), {
    ...config,
    params: { owner_account_uuid: ownerAccountUuid },
  });

export const getOrderAction = (
  apiClient: AxiosInstance,
  actionId: string,
  ownerAccountUuid: string,
  config?: AxiosRequestConfig,
) =>
  apiClient.get<OrderActionSnapshot>(TRADING_ENDPOINTS.ORDERS.ACTION(actionId), {
    ...config,
    params: { owner_account_uuid: ownerAccountUuid },
  });

export const getOrderCancelMessage = (
  apiClient: AxiosInstance,
  uuid: string,
  data: OrderActionRequest,
  config?: AxiosRequestConfig,
) =>
  apiClient.post<OrderActionSnapshot>(
    TRADING_ENDPOINTS.ORDERS.CANCEL_MESSAGE(uuid),
    {
      action_id: data.actionId,
      owner_account_uuid: data.ownerAccountUuid,
    },
    config,
  );

export const createOrder = (apiClient: AxiosInstance, data: SignedCreateOrderRequest, config?: AxiosRequestConfig) =>
  apiClient.post<OrderSubmissionSnapshot>(
    TRADING_ENDPOINTS.ORDERS.CREATE,
    {
      ...orderSubmissionBody(data),
      digest: data.digest,
      signature: data.signature,
    },
    config,
  );

export const cancelOrder = (
  apiClient: AxiosInstance,
  uuid: string,
  data: OrderActionExecuteRequest,
  config?: AxiosRequestConfig,
) =>
  apiClient.post<OrderActionSnapshot>(
    TRADING_ENDPOINTS.ORDERS.CANCEL(uuid),
    {
      action_id: data.actionId,
      owner_account_uuid: data.ownerAccountUuid,
      digest: data.digest,
      signature: data.signature,
    },
    config,
  );

export const getWalletBalances = (apiClient: AxiosInstance, walletAddress: string) =>
  apiClient.get<WalletTokenBalancesResponse>(TRADING_ENDPOINTS.WALLETS.BALANCES, {
    params: { wallet_address: walletAddress },
  });

export const getWhitelistStatus = (apiClient: AxiosInstance, tokenAddress: string, walletAddress: string) =>
  apiClient.get<WhitelistStatus>(TRADING_ENDPOINTS.WHITELIST.STATUS(tokenAddress, walletAddress));

export const getSwapOrders = (apiClient: AxiosInstance, walletAddress: string, page?: number) =>
  apiClient.get<ApiResponse<'api_v1_trading_swaps_list'>>(TRADING_ENDPOINTS.SWAPS.LIST, {
    params: { wallet_address: walletAddress, ...(page ? { page } : {}) },
  });

export const getOrderModificationMessage = (
  apiClient: AxiosInstance,
  orderUuid: string,
  data: OrderActionModificationRequest,
  config?: AxiosRequestConfig,
) =>
  apiClient.post<OrderActionSnapshot>(
    TRADING_ENDPOINTS.ORDERS.MODIFY_MESSAGE(orderUuid),
    {
      action_id: data.actionId,
      owner_account_uuid: data.ownerAccountUuid,
      new_quantity: data.newQuantity,
      new_min_quantity: data.newMinQuantity,
      new_price_per_share: data.newPricePerShare,
    },
    config,
  );

export const modifyOrder = (
  apiClient: AxiosInstance,
  orderUuid: string,
  data: OrderActionExecuteRequest,
  config?: AxiosRequestConfig,
) =>
  apiClient.post<OrderActionSnapshot>(
    TRADING_ENDPOINTS.ORDERS.MODIFY(orderUuid),
    {
      action_id: data.actionId,
      owner_account_uuid: data.ownerAccountUuid,
      digest: data.digest,
      signature: data.signature,
    },
    config,
  );

export function parseTradingError(error: unknown): string {
  const data = (error as { response?: { data?: { code?: unknown; detail?: unknown } } } | null)?.response?.data;
  if (data?.code === 'not_whitelisted' || (typeof data?.detail === 'string' && data.detail.includes('not whitelisted')))
    return NOT_ALLOWLISTED;
  if (failureStatus(error) === 403 && !hasServiceErrorDetail(error)) return NOT_AUTHORISED;
  return failureSentence(error, 'The order could not be processed. Try again.');
}

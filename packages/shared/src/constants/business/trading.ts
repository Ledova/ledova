import type { ApiComponents, TradingEventType } from '../../generated/api';

export type { TradingEventType } from '../../generated/api';

export type OrderType = ApiComponents['schemas']['TransferOrderTypeEnum'];

export const TRADING_EVENT_INVALIDATION_MAP: Record<TradingEventType, string[][]> = {
  order_created: [
    ['trading', 'orderBook'],
    ['trading', 'userOrders'],
  ],
  order_cancelled: [
    ['trading', 'orderBook'],
    ['trading', 'userOrders'],
  ],
  order_modified: [
    ['trading', 'orderBook'],
    ['trading', 'userOrders'],
  ],
  order_listed: [
    ['trading', 'orderBook'],
    ['trading', 'userOrders'],
  ],
  order_matched: [
    ['trading', 'orderBook'],
    ['trading', 'userOrders'],
    ['trading', 'swaps'],
  ],
  swap_signed: [['trading', 'swaps']],
  swap_completed: [
    ['trading', 'orderBook'],
    ['trading', 'swaps'],
    ['trading', 'userOrders'],
    ['trading', 'walletBalances'],
  ],
  swap_failed: [
    ['trading', 'orderBook'],
    ['trading', 'swaps'],
    ['trading', 'userOrders'],
  ],
  swap_expired: [
    ['trading', 'orderBook'],
    ['trading', 'userOrders'],
    ['trading', 'swaps'],
  ],
};

export const TRADING_ENDPOINTS = {
  TOKENS: {
    LIST: '/api/v1/trading/tokens/',
    ORDER_BOOK: (uuid: string) => `/api/v1/trading/tokens/${uuid}/order-book/` as const,
  },
  ORDERS: {
    LIST: '/api/v1/trading/orders/',
    CREATE: '/api/v1/trading/orders/create/',
    CREATE_MESSAGE: '/api/v1/trading/orders/create/message/',
    SUBMISSION: (uuid: string) => `/api/v1/trading/orders/submissions/${uuid}/` as const,
    CANCEL: (uuid: string) => `/api/v1/trading/orders/${uuid}/cancel/` as const,
    ACTION_CONTEXT: (uuid: string) => `/api/v1/trading/orders/${uuid}/action-context/`,
    ACTION: (actionId: string) => `/api/v1/trading/orders/actions/${actionId}/`,
    CANCEL_MESSAGE: (uuid: string) => `/api/v1/trading/orders/${uuid}/cancel/message/` as const,
    MODIFY: (uuid: string) => `/api/v1/trading/orders/${uuid}/modify/` as const,
    MODIFY_MESSAGE: (uuid: string) => `/api/v1/trading/orders/${uuid}/modify/message/` as const,
    SWAP: (uuid: string) => `/api/v1/trading/orders/${uuid}/swap/` as const,
    SWAP_SIGN: (uuid: string) => `/api/v1/trading/orders/${uuid}/swap/sign/` as const,
    SWAP_APPROVAL_STATUS: (uuid: string) => `/api/v1/trading/orders/${uuid}/swap/approval-status/` as const,
    SWAP_APPROVAL_DATA: (uuid: string) => `/api/v1/trading/orders/${uuid}/swap/approval-data/` as const,
    SWAP_APPROVAL_BROADCAST: (uuid: string) => `/api/v1/trading/orders/${uuid}/swap/approval-broadcast/` as const,
  },
  WALLETS: {
    BALANCES: '/api/v1/trading/wallets/balances/',
  },
  SWAPS: {
    LIST: '/api/v1/trading/swaps/',
  },
  WHITELIST: {
    STATUS: (tokenAddress: string, address: string) =>
      `/api/v1/trading/whitelist/${tokenAddress}/${address}/status/` as const,
  },
  EVENTS: {
    STREAM: '/api/v1/trading/events/stream/',
  },
} as const;

export const TRADING_CONFIG = {
  ORDER_BOOK_FALLBACK_INTERVAL: 120000,
  SSE_RECONNECT_DELAY: 3000,
  SSE_MAX_RECONNECT_DELAY: 30000,
} as const;

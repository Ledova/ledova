export const TRADING_ENDPOINTS = {
  WHITELIST: {
    STATUS: (tokenAddress: string, address: string) =>
      `/api/v1/trading/whitelist/${tokenAddress}/${address}/status/` as const,
  },
} as const;

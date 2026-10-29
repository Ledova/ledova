import type { AxiosInstance } from 'axios';
import { TRADING_ENDPOINTS } from '../constants';
import type { WhitelistStatus } from '../types';

export const getWhitelistStatus = (apiClient: AxiosInstance, tokenAddress: string, walletAddress: string) =>
  apiClient.get<WhitelistStatus>(TRADING_ENDPOINTS.WHITELIST.STATUS(tokenAddress, walletAddress));

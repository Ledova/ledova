import { AxiosInstance } from 'axios';
import { ASSET_ENDPOINTS } from '../constants';
import type { ExchangeRate } from '../types';

export const getExchangeRate = (apiClient: AxiosInstance) => {
  return apiClient.get<ExchangeRate>(ASSET_ENDPOINTS.EXCHANGE_RATES, {
    params: { currency: 'AUD' },
  });
};

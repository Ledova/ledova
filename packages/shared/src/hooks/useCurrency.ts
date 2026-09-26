import { useQuery } from '@tanstack/react-query';

import { CACHE_TIMING } from '../constants/api';
import { getExchangeRate } from '../services/exchangeRates';
import { formatCurrency } from '../utils/formatting';
import { useApiClient } from './useApiClient';
import { useAuth } from './useAuth';

export function useCurrency() {
  const apiClient = useApiClient();
  const { isAuthenticated } = useAuth();
  const query = useQuery({
    queryKey: ['exchangeRate', 'AUD'],
    queryFn: () => getExchangeRate(apiClient),
    staleTime: CACHE_TIMING.LONG_STALE_TIME,
    gcTime: CACHE_TIMING.EXTRA_LONG_GC_TIME,
    enabled: isAuthenticated,
  });
  const rate = parseFloat(query.data?.data?.rate ?? '0') || 0;

  const formatDisplayCurrency = (usdValue?: number | null, decimals: number = 2): string => {
    if (usdValue === undefined || usdValue === null || isNaN(usdValue) || !rate) return '—';
    return formatCurrency(usdValue * rate, { currency: 'AUD', locale: 'en-AU', decimals });
  };

  return {
    exchangeRate: rate,
    formatDisplayCurrency,
    isLoading: query.isLoading,
  };
}

import { useState, useCallback, useEffect, useRef } from 'react';
import { apiClient } from '../services/apiClient';
import { fetchImportBalances } from '@ledova/shared';
import type { DerivedAddress } from '@ledova/shared';

export function useFetchBalances() {
  const [balances, setBalances] = useState<Map<string, string>>(new Map());
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  const fetchBalances = useCallback(async (addressList: DerivedAddress[]) => {
    const current = ++generation.current;
    setBalances(new Map());
    setIsLoadingBalances(true);
    const result = await fetchImportBalances(apiClient, addressList);
    if (current === generation.current) {
      setBalances(result);
      setIsLoadingBalances(false);
    }
  }, []);

  return { balances, isLoadingBalances, fetchBalances };
}

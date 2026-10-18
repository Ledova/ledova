import { useEffect, useState } from 'react';
import { fetchImportBalances, type HardwareWalletImport } from '@ledova/shared';
import apiClient from '@services/apiClient';

export function useImportBalances(importData: HardwareWalletImport | null) {
  const [balances, setBalances] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!importData) return;
    let active = true;
    void fetchImportBalances(apiClient, importData.addresses).then((next) => {
      if (active) setBalances(next);
    });
    return () => {
      active = false;
    };
  }, [importData]);
  return balances;
}

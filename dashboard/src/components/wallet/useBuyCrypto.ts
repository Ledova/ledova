import { useContext } from 'react';
import { BuyCryptoContext, type BuyCryptoContextValue } from './BuyCryptoContext';

export function useBuyCrypto(): BuyCryptoContextValue {
  const context = useContext(BuyCryptoContext);
  if (!context) {
    throw new Error('useBuyCrypto must be used within a BuyCryptoProvider');
  }
  return context;
}

import { createContext } from 'react';

export interface BuyCryptoContextValue {
  openBuyCrypto: () => void;
  canBuyCrypto: boolean;
}

export const BuyCryptoContext = createContext<BuyCryptoContextValue | null>(null);

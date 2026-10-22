import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { WebLedgerTask } from '@utils/destinations';

export interface LedgerNavigationState {
  company?: string;
  token?: string;
  task?: WebLedgerTask;
  blocked: boolean;
}

interface LedgerNavigationValue {
  state: LedgerNavigationState | null;
  setState: Dispatch<SetStateAction<LedgerNavigationState | null>>;
}

export const LedgerNavigation = createContext<LedgerNavigationValue>({ state: null, setState: () => undefined });

export function useLedgerNavigation() {
  return useContext(LedgerNavigation);
}

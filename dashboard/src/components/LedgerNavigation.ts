import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { LedgerTask } from '@utils/destinations';

export interface LedgerNavigationState {
  company?: string;
  token?: string;
  task?: LedgerTask;
  shareholderView?: 'shareholders' | 'awards' | 'member-access' | 'member-requests';
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

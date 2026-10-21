import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import { DESTINATIONS } from '@ledova/shared';

export interface LedgerNavigationState {
  company?: string;
  token?: string;
  task?: keyof typeof DESTINATIONS.companyRegister.tasks;
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

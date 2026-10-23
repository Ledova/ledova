import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { DESTINATIONS, type LedgerTask } from '@ledova/shared';

export function isLedgerTask(value: unknown): value is LedgerTask {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DESTINATIONS.companyRegister.tasks, value);
}

export interface LedgerNavigationState {
  task?: LedgerTask;
  blocked: boolean;
}

interface LedgerNavigationValue {
  state: LedgerNavigationState | null;
  setState: Dispatch<SetStateAction<LedgerNavigationState | null>>;
}

const LedgerNavigation = createContext<LedgerNavigationValue>({ state: null, setState: () => undefined });

export function LedgerNavigationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LedgerNavigationState | null>(null);
  const value = useMemo(() => ({ state, setState }), [state]);
  return <LedgerNavigation.Provider value={value}>{children}</LedgerNavigation.Provider>;
}

export function useLedgerNavigation() {
  return useContext(LedgerNavigation);
}

import { useState, type ReactNode } from 'react';
import { LedgerNavigation, type LedgerNavigationState } from './LedgerNavigation';

export function LedgerNavigationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LedgerNavigationState | null>(null);
  return <LedgerNavigation.Provider value={{ state, setState }}>{children}</LedgerNavigation.Provider>;
}

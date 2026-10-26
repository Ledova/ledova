import { createContext, useContext } from 'react';
import type { WorkspaceMode } from '@services/workspace';
import type { useSettingsNavigation } from './useSettingsNavigation';

export interface WorkspaceValue {
  mode: WorkspaceMode;
  preferred: WorkspaceMode | null;
  canSwitchShares: boolean;
  canCompany: boolean;
  canRegister: boolean;
  pending: boolean;
  unavailable: boolean;
  retry: () => Promise<unknown>;
  change: (mode: WorkspaceMode) => boolean;
  settings: ReturnType<typeof useSettingsNavigation>;
}

export const Workspace = createContext<WorkspaceValue | null>(null);

export function useWorkspace() {
  return useContext(Workspace);
}

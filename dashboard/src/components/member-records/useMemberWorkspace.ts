import { createContext, useContext } from 'react';
import type { useMemberRecords } from '@ledova/shared';

export type MemberWorkspace = {
  read: ReturnType<typeof useMemberRecords>;
  held: boolean;
  token: string;
  selectToken: (uuid: string) => void;
};

export const MemberWorkspaceContext = createContext<MemberWorkspace | null>(null);

export function useMemberWorkspace() {
  const value = useContext(MemberWorkspaceContext);
  if (!value) throw new Error('Member records need their signed-in workspace.');
  return value;
}

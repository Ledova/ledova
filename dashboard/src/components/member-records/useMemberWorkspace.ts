import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { useMemberRecords } from '@ledova/shared';

export type MemberDraft = { name: string; address: string; confirmed: boolean; open: boolean };

export type MemberWorkspace = {
  read: ReturnType<typeof useMemberRecords>;
  held: boolean;
  draft: MemberDraft;
  setDraft: Dispatch<SetStateAction<MemberDraft>>;
  token: string;
  selectToken: (uuid: string) => void;
};

export const MemberWorkspaceContext = createContext<MemberWorkspace | null>(null);

export function useMemberWorkspace() {
  const value = useContext(MemberWorkspaceContext);
  if (!value) throw new Error('Member records need their signed-in workspace.');
  return value;
}

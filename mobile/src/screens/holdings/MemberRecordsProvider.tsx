import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import * as Crypto from 'expo-crypto';
import { useMemberRecords } from '@ledova/shared';
import { orderSubmissionSession } from '../../services/orderSubmissions';

export interface MemberDraft {
  name: string;
  address: string;
  confirmed: boolean;
}

const EMPTY_DRAFT: MemberDraft = { name: '', address: '', confirmed: false };

interface MemberRecords {
  read: ReturnType<typeof useMemberRecords>;
  draft: MemberDraft;
  setDraft: Dispatch<SetStateAction<MemberDraft>>;
  select: (uuid: string) => void;
}

const MemberRecordsContext = createContext<MemberRecords | null>(null);

export function MemberRecordsProvider({ children }: { children: ReactNode }) {
  const read = useMemberRecords(Crypto.randomUUID, orderSubmissionSession);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const selected = useRef('');
  useEffect(() => {
    selected.current = '';
    setDraft(EMPTY_DRAFT);
  }, [read.scopeOwner]);
  return (
    <MemberRecordsContext.Provider
      value={{
        read,
        draft,
        setDraft,
        select: (uuid) => {
          if (read.busy || read.retry || selected.current === uuid) return;
          selected.current = uuid;
          setDraft(EMPTY_DRAFT);
          read.select(uuid);
        },
      }}
    >
      {children}
    </MemberRecordsContext.Provider>
  );
}

export function useMemberRecordsState() {
  const value = useContext(MemberRecordsContext);
  if (!value) throw new Error('Member records need their signed-in provider.');
  return value;
}

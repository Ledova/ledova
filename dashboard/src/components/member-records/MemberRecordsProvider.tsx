import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { DESTINATIONS, useMemberRecords } from '@ledova/shared';
import { MemberWorkspaceContext, type MemberDraft } from './useMemberWorkspace';
import { useMemberFreshness } from './useMemberFreshness';

const EMPTY_DRAFT: MemberDraft = { name: '', address: '', confirmed: false, open: false };

export function MemberRecordsProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const active = [DESTINATIONS.home.path, DESTINATIONS.memberRecords.path, DESTINATIONS.settings.path].some(
    (path) => path === pathname,
  );
  return active ? <MemberSession>{children}</MemberSession> : children;
}

function MemberSession({ children }: { children: ReactNode }) {
  const read = useMemberRecords(() => crypto.randomUUID(), undefined, { coordinatedRefresh: true });
  useMemberFreshness(read);
  return (
    <MemberState key={`${read.scopeOwner?.userUuid}/${read.scopeOwner?.ownerAccountUuid}`} read={read}>
      {children}
    </MemberState>
  );
}

function MemberState({ children, read }: { children: ReactNode; read: ReturnType<typeof useMemberRecords> }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [token, setToken] = useState('');
  const selectionOwner = useRef<typeof read.owner>(null);
  const initialHistory = useRef('');
  const held = read.busy || read.refreshing || read.readFailed || !read.owner || !!read.retry;
  useEffect(() => {
    if (read.owner && selectionOwner.current !== read.owner && read.records.length === 1 && !read.busy && !read.retry) {
      selectionOwner.current = read.owner;
      read.select(read.records[0].uuid);
    }
  }, [read.owner, read.records, read.busy, read.retry, read.select]);
  useEffect(() => {
    if (read.record && !held) {
      const item = read.record.classes.find((item) => item.uuid === token) ?? read.record.classes[0];
      const selection = item ? `${read.record.uuid}/${item.uuid}` : '';
      if (selection === initialHistory.current) return;
      initialHistory.current = selection;
      setToken(item?.uuid ?? '');
      read.selectToken(item?.uuid ?? '');
    }
  }, [read.record, read.selectToken, held, token]);
  return (
    <MemberWorkspaceContext.Provider
      value={{
        read,
        held,
        draft,
        setDraft,
        token,
        select: (uuid) => {
          if (read.busy || read.refreshing || read.retry || !read.owner) return;
          selectionOwner.current = read.owner;
          initialHistory.current = '';
          setToken('');
          setDraft(EMPTY_DRAFT);
          read.select(uuid);
        },
        selectToken: (uuid) => {
          if (held) return;
          setToken(uuid);
          read.selectToken(uuid);
        },
      }}
    >
      {children}
    </MemberWorkspaceContext.Provider>
  );
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { DESTINATIONS, useMemberRecords } from '@ledova/shared';
import { CERTIFICATES_PATH } from '@utils/paths';
import { MemberWorkspaceContext, type MemberDraft } from './useMemberWorkspace';

const EMPTY_DRAFT: MemberDraft = { name: '', address: '', confirmed: false, open: false };

export function MemberRecordsProvider({ children }: { children: ReactNode }) {
  const { pathname, hash } = useLocation();
  const active = pathname === CERTIFICATES_PATH || (pathname === DESTINATIONS.settings.path && hash === '#profile');
  const read = useMemberRecords(() => crypto.randomUUID(), undefined, { coordinatedRefresh: true, enabled: active });
  return (
    <MemberState key={`${read.scopeOwner?.userUuid}/${read.scopeOwner?.ownerAccountUuid}`} read={read} active={active}>
      {children}
    </MemberState>
  );
}

function MemberState({
  children,
  read,
  active,
}: {
  children: ReactNode;
  read: ReturnType<typeof useMemberRecords>;
  active: boolean;
}) {
  const location = useLocation();
  const requested = new URLSearchParams(location.search).get('company');
  const requestedClass =
    location.pathname === CERTIFICATES_PATH ? new URLSearchParams(location.search).get('class') : null;
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [token, setToken] = useState('');
  const selectionOwner = useRef<typeof read.owner>(null);
  const initialHistory = useRef('');
  const particularsRequest = useRef('');
  const held = read.busy || read.refreshing || read.readFailed || !read.owner || !!read.retry;
  useEffect(() => {
    if (read.retry?.kind === 'particulars') particularsRequest.current = read.retry.operationId;
    if (!held && read.requests?.particulars.some((request) => request.uuid === particularsRequest.current)) {
      particularsRequest.current = '';
      setDraft(EMPTY_DRAFT);
    }
  }, [read.retry, read.requests, held]);
  useEffect(() => {
    if (!active || draft.open || !read.owner || !read.listReady || read.busy || read.refreshing || read.retry) return;
    const wanted = requested ? (read.records.find(({ company }) => company.uuid === requested)?.uuid ?? '') : '';
    if (selectionOwner.current !== read.owner || read.selectedUuid !== wanted) {
      selectionOwner.current = read.owner;
      initialHistory.current = '';
      particularsRequest.current = '';
      setToken('');
      setDraft(EMPTY_DRAFT);
      read.select(wanted);
    }
  }, [
    read.owner,
    read.listReady,
    read.busy,
    read.refreshing,
    read.retry,
    read.records,
    read.selectedUuid,
    read.select,
    requested,
    active,
    draft.open,
  ]);
  useEffect(() => {
    if (active && read.record && !held) {
      const item = requestedClass
        ? read.record.classes.find((item) => item.uuid === requestedClass)
        : (read.record.classes.find((item) => item.uuid === token) ?? read.record.classes[0]);
      const selection = item ? `${read.record.uuid}/${item.uuid}` : '';
      if (selection === initialHistory.current) return;
      initialHistory.current = selection;
      setToken(item?.uuid ?? '');
      read.selectToken(item?.uuid ?? '');
    }
  }, [active, read.record, read.selectToken, held, token, requestedClass]);
  return (
    <MemberWorkspaceContext.Provider
      value={{
        read,
        held,
        draft,
        setDraft,
        token,
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

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DESTINATIONS, useMemberRecords } from '@ledova/shared';
import { MemberWorkspaceContext, type MemberDraft } from './useMemberWorkspace';
import { useMemberFreshness } from './useMemberFreshness';

const EMPTY_DRAFT: MemberDraft = { name: '', address: '', confirmed: false, open: false };

export function MemberRecordsProvider({ children }: { children: ReactNode }) {
  return <MemberSession>{children}</MemberSession>;
}

function MemberSession({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const active = [DESTINATIONS.home.path, DESTINATIONS.memberRecords.path, DESTINATIONS.settings.path].some(
    (path) => path === pathname,
  );
  const read = useMemberRecords(() => crypto.randomUUID(), undefined, { coordinatedRefresh: true });
  useMemberFreshness(read, active);
  return (
    <MemberState key={`${read.scopeOwner?.userUuid}/${read.scopeOwner?.ownerAccountUuid}`} read={read}>
      {children}
    </MemberState>
  );
}

function MemberState({ children, read }: { children: ReactNode; read: ReturnType<typeof useMemberRecords> }) {
  const location = useLocation();
  const navigate = useNavigate();
  const requested = new URLSearchParams(location.search).get('company');
  const active = [DESTINATIONS.home.path, DESTINATIONS.memberRecords.path, DESTINATIONS.settings.path].some(
    (path) => path === location.pathname,
  );
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
    const wanted = requested
      ? (read.records.find(({ company }) => company.uuid === requested)?.uuid ?? '')
      : read.records.length === 1
        ? read.records[0]!.uuid
        : '';
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
          const company = read.records.find((record) => record.uuid === uuid)?.company.uuid;
          if (company) {
            const next = new URLSearchParams(location.search);
            next.set('company', company);
            navigate({ search: next.toString(), hash: location.hash }, { state: location.state });
          }
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

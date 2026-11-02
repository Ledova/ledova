import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { DESTINATIONS, useMemberRecords } from '@ledova/shared';
import { MemberWorkspaceContext } from './useMemberWorkspace';

export function MemberRecordsProvider({ children }: { children: ReactNode }) {
  const { pathname, hash } = useLocation();
  const certificates = pathname === DESTINATIONS.certificates.path;
  const active = certificates || (pathname === DESTINATIONS.settings.path && hash === '#profile');
  const read = useMemberRecords(undefined, {
    coordinatedRefresh: true,
    enabled: active,
    readList: certificates,
  });
  return (
    <MemberState
      key={`${read.scopeOwner?.userUuid}/${read.scopeOwner?.ownerAccountUuid}`}
      read={read}
      active={active}
      certificates={certificates}
    >
      {children}
    </MemberState>
  );
}

function MemberState({
  children,
  read,
  active,
  certificates,
}: {
  children: ReactNode;
  read: ReturnType<typeof useMemberRecords>;
  active: boolean;
  certificates: boolean;
}) {
  const location = useLocation();
  const requested = new URLSearchParams(location.search).get('company');
  const requestedClass =
    location.pathname === DESTINATIONS.certificates.path ? new URLSearchParams(location.search).get('class') : null;
  const [token, setToken] = useState('');
  const selectionOwner = useRef<typeof read.owner>(null);
  const initialHistory = useRef('');
  const held = read.refreshing || read.readFailed || !read.owner;
  useEffect(() => {
    if (!active || !read.owner || !read.listReady || read.refreshing) return;
    const wanted = requested ? (read.records.find(({ company }) => company.uuid === requested)?.uuid ?? '') : '';
    if (selectionOwner.current !== read.owner || read.selectedUuid !== wanted) {
      selectionOwner.current = read.owner;
      initialHistory.current = '';
      setToken('');
      read.select(wanted);
    }
  }, [read.owner, read.listReady, read.refreshing, read.records, read.selectedUuid, read.select, requested, active]);
  useEffect(() => {
    if (!certificates) {
      if (!initialHistory.current || held) return;
      initialHistory.current = '';
      read.selectToken('');
    } else if (read.record && !held) {
      const item = requestedClass
        ? read.record.classes.find((item) => item.uuid === requestedClass)
        : (read.record.classes.find((item) => item.uuid === token) ?? read.record.classes[0]);
      const selection = item ? `${read.record.uuid}/${item.uuid}` : '';
      if (selection === initialHistory.current) return;
      initialHistory.current = selection;
      setToken(item?.uuid ?? '');
      read.selectToken(item?.uuid ?? '');
    }
  }, [certificates, read.record, read.selectToken, held, token, requestedClass]);
  return (
    <MemberWorkspaceContext.Provider
      value={{
        read,
        held,
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

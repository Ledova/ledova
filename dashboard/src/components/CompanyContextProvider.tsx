import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  matchPath,
  useBeforeUnload,
  useBlocker,
  useLocation,
  useNavigate,
  type BlockerFunction,
} from 'react-router-dom';
import { DESTINATIONS, useSubmissionOwner } from '@ledova/shared';
import { CompanyContext } from '@hooks/useCompanyContext';
import { useOwnershipCompanies } from '@hooks/useOwnershipCompanies';
import { documentView } from '@utils/destinations';
import { useLedgerNavigation } from './LedgerNavigation';
import { Confirmation } from './Modal';
import { MemberWorkspaceContext } from './member-records/useMemberWorkspace';

function ledgerParams(pathname: string) {
  return Object.values(DESTINATIONS)
    .filter(({ path }) => path.startsWith(DESTINATIONS.companyRegister.path))
    .sort((left, right) => Number(left.path.includes(':')) - Number(right.path.includes(':')))
    .map(({ path }) => matchPath(path, pathname)?.params)
    .find(Boolean);
}

export function CompanyContextProvider({ children }: { children: ReactNode }) {
  const { owner, boundary } = useSubmissionOwner();
  const directory = useOwnershipCompanies();
  const location = useLocation();
  const navigate = useNavigate();
  const ledger = useLedgerNavigation();
  const member = useContext(MemberWorkspaceContext);
  const dirtyForms = useRef(new WeakSet<HTMLFormElement>());
  const requested = useRef(false);
  const [blockedAt, setBlockedAt] = useState<{
    owner: typeof owner;
    location: string;
  } | null>(null);
  const params = ledgerParams(location.pathname);
  const token = params?.uuid;
  const query = new URLSearchParams(location.search);
  const stated = typeof location.state?.registerCompany === 'string' ? location.state.registerCompany : null;
  const entered = params?.company ?? query.get('company') ?? stated;
  const ledgerCompany =
    location.pathname === DESTINATIONS.companyRegister.path || (token && ledger.state?.token === token)
      ? ledger.state?.company
      : undefined;
  const companyUuid =
    entered ?? ledgerCompany ?? (!token && directory.companies.length === 1 ? directory.companies[0]!.uuid : null);
  const company = directory.companies.find(({ uuid }) => uuid === companyUuid);
  const ledgerHeld = location.pathname === DESTINATIONS.companyRegister.path && !!ledger.state?.held;
  const memberHeld = !!member?.read.busy || !!member?.read.retry;
  const held = ledgerHeld || memberHeld;
  const allowed = (uuid: string | null) =>
    !!owner && boundary.get() === owner && !held && (!uuid || directory.companies.some((row) => row.uuid === uuid));
  const isDirty = useCallback(
    () => [...document.querySelectorAll('main form')].some((form) => dirtyForms.current.has(form as HTMLFormElement)),
    [],
  );
  const blocker = useBlocker(
    useCallback<BlockerFunction>(
      ({ currentLocation, nextLocation, historyAction }) => {
        const internal = requested.current;
        requested.current = false;
        if (!owner || boundary.get() !== owner) return false;
        const nextQuery = new URLSearchParams(nextLocation.search);
        const currentQuery = new URLSearchParams(currentLocation.search);
        const next = nextQuery.get('company');
        nextQuery.delete('company');
        currentQuery.delete('company');
        nextQuery.sort();
        currentQuery.sort();
        const stated =
          typeof nextLocation.state?.registerCompany === 'string' ? nextLocation.state.registerCompany : null;
        const target =
          ledgerParams(nextLocation.pathname)?.company ??
          next ??
          stated ??
          (nextLocation.pathname === DESTINATIONS.home.path && directory.companies.length > 1 ? null : companyUuid);
        const changingCompany = target !== companyUuid;
        const hash = nextLocation.hash.slice(1);
        if (
          ledgerHeld &&
          !memberHeld &&
          !changingCompany &&
          currentLocation.pathname === DESTINATIONS.companyRegister.path &&
          nextLocation.pathname === currentLocation.pathname &&
          nextQuery.toString() === currentQuery.toString() &&
          (nextLocation.state?.registerToken ?? ledger.state?.token) ===
            (currentLocation.state?.registerToken ?? ledger.state?.token) &&
          (nextLocation.state?.registerCompany ?? companyUuid) ===
            (currentLocation.state?.registerCompany ?? companyUuid) &&
          (documentView(hash) || hash === ledger.state?.task)
        )
          return false;
        const memberPages = [DESTINATIONS.home.path, DESTINATIONS.memberRecords.path, DESTINATIONS.settings.path];
        const persistentDraft =
          !!member?.draft.open &&
          !changingCompany &&
          memberPages.some((path) => path === currentLocation.pathname) &&
          memberPages.some((path) => path === nextLocation.pathname);
        const changingPage =
          currentLocation.pathname !== nextLocation.pathname || currentLocation.hash !== nextLocation.hash;
        const blocked =
          held ||
          (changingCompany && !!member?.draft.open) ||
          (!persistentDraft && (changingCompany || internal || (historyAction === 'POP' && changingPage)) && isDirty());
        if (blocked) setBlockedAt({ owner, location: currentLocation.key });
        return blocked;
      },
      [
        owner,
        boundary,
        companyUuid,
        directory.companies.length,
        member?.draft.open,
        held,
        ledgerHeld,
        memberHeld,
        ledger.state?.token,
        ledger.state?.task,
        isDirty,
      ],
    ),
  );
  useBeforeUnload(
    useCallback(
      (event) => {
        if (!owner || boundary.get() !== owner || (!held && !member?.draft.open && !isDirty())) return;
        event.preventDefault();
        event.returnValue = '';
      },
      [owner, boundary, held, member?.draft.open, isDirty],
    ),
  );
  useEffect(() => {
    dirtyForms.current = new WeakSet();
    requested.current = false;
  }, [owner]);
  useEffect(() => {
    if (
      blocker.state === 'blocked' &&
      (held || !blockedAt || blockedAt.owner !== owner || blockedAt.location !== location.key)
    ) {
      blocker.reset();
    }
  }, [blocker, blockedAt, held, owner, location.key]);
  useEffect(() => {
    if (
      location.pathname !== DESTINATIONS.home.path ||
      entered !== null ||
      directory.isLoading ||
      directory.isRefreshing ||
      directory.hasError ||
      directory.companies.length !== 1
    )
      return;
    const next = new URLSearchParams(location.search);
    next.set('company', directory.companies[0]!.uuid);
    navigate({ search: next.toString(), hash: location.hash }, { replace: true, state: location.state });
  }, [directory, entered, location, navigate]);
  useEffect(() => {
    const changed = (event: Event) => {
      const control = event.target;
      if (!(control instanceof HTMLElement)) return;
      const form = control.closest('main form');
      if (form instanceof HTMLFormElement) dirtyForms.current.add(form);
    };
    document.addEventListener('input', changed, true);
    document.addEventListener('change', changed, true);
    return () => {
      document.removeEventListener('input', changed, true);
      document.removeEventListener('change', changed, true);
    };
  }, []);
  const companyPath = (path: string) => {
    const [beforeHash, hash] = path.split('#');
    const [pathname, search] = beforeHash!.split('?');
    const next = new URLSearchParams(search);
    if (companyUuid) next.set('company', companyUuid);
    const value = next.toString();
    return `${pathname}${value ? `?${value}` : ''}${hash ? `#${hash}` : ''}`;
  };
  const request = (uuid: string | null, path: string) => {
    if (!allowed(uuid)) return false;
    requested.current = true;
    void navigate(path);
    return true;
  };
  const selectCompany = (uuid: string | null, preservePage = false) => {
    const next = new URLSearchParams(preservePage ? location.search : undefined);
    next.delete('class');
    next.delete('search');
    next.delete('page');
    if (uuid) next.set('company', uuid);
    else next.delete('company');
    const path = preservePage ? location.pathname : DESTINATIONS.home.path;
    const search = next.toString();
    return request(uuid, `${path}${search ? `?${search}` : ''}${preservePage ? location.hash : ''}`);
  };
  return (
    <CompanyContext.Provider
      value={{
        directory,
        companyUuid,
        company,
        held,
        selectCompany,
        companyPath,
        openDashboard: () =>
          request(company?.uuid ?? null, company ? companyPath(DESTINATIONS.home.path) : DESTINATIONS.home.path),
      }}
    >
      {children}
      <Confirmation
        isOpen={
          blocker.state === 'blocked' && !held && blockedAt?.owner === owner && blockedAt.location === location.key
        }
        title="Leave this page?"
        confirmLabel="Leave page"
        confirmDisabled={held || blockedAt?.owner !== owner || blockedAt?.location !== location.key}
        onClose={() => {
          if (blocker.state === 'blocked') blocker.reset();
          setBlockedAt(null);
        }}
        onConfirm={() => {
          if (
            blocker.state === 'blocked' &&
            !held &&
            blockedAt &&
            boundary.get() === blockedAt.owner &&
            location.key === blockedAt.location
          ) {
            dirtyForms.current = new WeakSet();
            member?.setDraft({ name: '', address: '', confirmed: false, open: false });
            setBlockedAt(null);
            blocker.proceed();
          }
        }}
      >
        You have unsaved changes on this page.
      </Confirmation>
    </CompanyContext.Provider>
  );
}

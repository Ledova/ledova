import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { DESTINATIONS, useSubmissionOwner } from '@ledova/shared';
import { CompanyContext } from '@hooks/useCompanyContext';
import { useOwnershipCompanies } from '@hooks/useOwnershipCompanies';
import { useLedgerNavigation } from './LedgerNavigation';
import { Confirmation } from './Modal';
import { MemberWorkspaceContext } from './member-records/useMemberWorkspace';

export function CompanyContextProvider({ children }: { children: ReactNode }) {
  const { owner, boundary } = useSubmissionOwner();
  const directory = useOwnershipCompanies();
  const location = useLocation();
  const navigate = useNavigate();
  const ledger = useLedgerNavigation();
  const member = useContext(MemberWorkspaceContext);
  const dirtyForms = useRef(new WeakSet<HTMLFormElement>());
  const [leaving, setLeaving] = useState<{
    owner: typeof owner;
    location: string;
    company: string | null;
    path: string;
  } | null>(null);
  const params = Object.values(DESTINATIONS)
    .filter(({ path }) => path.startsWith(DESTINATIONS.companyRegister.path))
    .sort((left, right) => Number(left.path.includes(':')) - Number(right.path.includes(':')))
    .map(({ path }) => matchPath(path, location.pathname)?.params)
    .find(Boolean);
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
  const held =
    (location.pathname === DESTINATIONS.companyRegister.path && !!ledger.state?.held) ||
    !!member?.read.busy ||
    !!member?.read.retry;
  const allowed = (uuid: string | null) =>
    !!owner && boundary.get() === owner && !held && (!uuid || directory.companies.some((row) => row.uuid === uuid));
  if (leaving && (leaving.owner !== owner || leaving.location !== location.key)) setLeaving(null);
  useEffect(() => {
    dirtyForms.current = new WeakSet();
  }, [owner]);
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
  const move = (uuid: string | null, path: string) => {
    if (!allowed(uuid)) return false;
    dirtyForms.current = new WeakSet();
    setLeaving(null);
    navigate(path);
    return true;
  };
  const request = (uuid: string | null, path: string) => {
    if (!allowed(uuid)) return false;
    if (
      (uuid !== companyUuid && member?.draft.open) ||
      [...document.querySelectorAll('main form')].some((form) => dirtyForms.current.has(form as HTMLFormElement))
    ) {
      setLeaving({ owner, location: location.key, company: uuid, path });
      return false;
    }
    return move(uuid, path);
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
        isOpen={!!leaving}
        title="Leave this page?"
        confirmLabel="Leave page"
        confirmDisabled={!leaving || !allowed(leaving.company)}
        onClose={() => setLeaving(null)}
        onConfirm={() => {
          if (leaving && boundary.get() === leaving.owner && location.key === leaving.location)
            move(leaving.company, leaving.path);
        }}
      >
        You have unsaved changes on this page.
      </Confirmation>
    </CompanyContext.Provider>
  );
}

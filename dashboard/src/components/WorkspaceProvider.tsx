import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DESTINATIONS, useSubmissionOwner } from '@ledova/shared';
import { useRegisterEntryState } from '@hooks/useRegisterAccess';
import { useSettingsNavigation } from '@hooks/useSettingsNavigation';
import { Workspace } from '@hooks/useWorkspace';
import { readWorkspace, rememberWorkspace, type WorkspaceMode } from '@services/workspace';
import { COMPANY_DASHBOARD_PATH } from '@utils/paths';
import { routeWorkspace } from '@utils/workspace';
import { useLedgerNavigation } from './LedgerNavigation';
import { Confirmation } from './Modal';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { owner, boundary } = useSubmissionOwner();
  const access = useRegisterEntryState();
  const settings = useSettingsNavigation();
  const location = useLocation();
  const navigate = useNavigate();
  const ledger = useLedgerNavigation();
  const dirtyForms = useRef(new WeakSet<HTMLFormElement>());
  const [choice, setChoice] = useState(() => ({ owner, mode: readWorkspace(owner) }));
  const [leaving, setLeaving] = useState<{
    owner: typeof owner;
    from: WorkspaceMode;
    to: WorkspaceMode;
    location: string;
  } | null>(null);
  const pending = access.isLoading || settings.isLoading;
  const unavailable = access.isError || settings.isError;
  const canCompany = access.canOpen || settings.canManageCompany || settings.canReviewEligibility;
  const requested = choice.owner === owner ? choice.mode : readWorkspace(owner);
  const preferred =
    requested === 'my-shares' || (requested === 'company' && (canCompany || pending || unavailable)) ? requested : null;
  const routed = routeWorkspace(location.pathname, location.hash);
  const mode = routed ?? preferred ?? (canCompany ? 'company' : 'my-shares');
  if (leaving && (leaving.owner !== owner || leaving.from !== mode || leaving.location !== location.key))
    setLeaving(null);
  const companyRefused = !routed && requested === 'company' && !canCompany && !pending && !unavailable;
  const resolvedDefault = !routed && requested === null && !pending && !unavailable ? mode : null;
  if (choice.owner !== owner || (routed && choice.mode !== routed) || companyRefused || resolvedDefault)
    setChoice({ owner, mode: routed ?? (companyRefused ? 'my-shares' : (resolvedDefault ?? readWorkspace(owner))) });
  useEffect(() => {
    if (!owner || pending || unavailable || (mode === 'company' && !canCompany)) return;
    rememberWorkspace(owner, mode);
  }, [owner, pending, unavailable, mode, canCompany]);
  useEffect(() => {
    dirtyForms.current = new WeakSet();
  }, [owner]);
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
  const held = location.pathname === DESTINATIONS.companyRegister.path && !!ledger.state?.held;
  const allowed = (next: WorkspaceMode) =>
    !!owner && boundary.get() === owner && !held && (next === 'my-shares' || (!pending && !unavailable && canCompany));
  const move = (next: WorkspaceMode) => {
    if (!allowed(next) || !owner) return false;
    dirtyForms.current = new WeakSet();
    setLeaving(null);
    rememberWorkspace(owner, next);
    setChoice({ owner, mode: next });
    navigate(next === 'company' ? COMPANY_DASHBOARD_PATH : DESTINATIONS.home.path);
    return true;
  };
  const change = (next: WorkspaceMode) => {
    if (next === mode) return true;
    if (!allowed(next)) return false;
    if ([...document.querySelectorAll('main form')].some((form) => dirtyForms.current.has(form as HTMLFormElement))) {
      setLeaving({ owner, from: mode, to: next, location: location.key });
      return false;
    }
    return move(next);
  };
  const activeLeaving =
    leaving?.owner === owner && leaving.from === mode && leaving.location === location.key ? leaving : null;
  return (
    <Workspace.Provider
      value={{
        mode,
        preferred,
        canSwitchShares: !!owner && !held,
        canCompany,
        canRegister: access.canOpen,
        pending: pending || held,
        unavailable,
        retry: () => Promise.all([access.refetch(), settings.retry()]),
        change,
        settings,
      }}
    >
      {children}
      <Confirmation
        isOpen={!!activeLeaving}
        title="Leave this workspace?"
        confirmLabel="Leave workspace"
        confirmDisabled={!activeLeaving || !allowed(activeLeaving.to)}
        onClose={() => setLeaving(null)}
        onConfirm={() => {
          if (
            activeLeaving &&
            boundary.get() === activeLeaving.owner &&
            mode === activeLeaving.from &&
            location.key === activeLeaving.location
          )
            move(activeLeaving.to);
        }}
      >
        You have unsaved changes on this page.
      </Confirmation>
    </Workspace.Provider>
  );
}

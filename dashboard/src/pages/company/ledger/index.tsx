import { SelectField } from '@components/SelectField';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, generatePath, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_COPY,
  appointmentForRegisterStep,
  ownershipSummary,
  useSubmissionOwner,
  useUserPreferences,
  USER_PREFERENCES_QUERY_KEY,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LoadError, Loading, Section } from '@components/Ledger';
import { PageTitle } from '@components/PageTitle';
import { documentView, ledgerTask, pageTitle, type DocumentView, type LedgerTask } from '@utils/destinations';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';
import { Page, PageAction, PageLink } from '@components/Page';
import { CompanyContextNotice } from '@components/CompanyContextNotice';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { certificatesLocation } from '@utils/paths';

import { ClassCorrections } from './ClassCorrections';
import { ClassImports } from './ClassImports';
import { ClassIssues } from './ClassIssues';
import { ClassAwards } from './ClassAwards';
import { ClassTransfers } from './ClassTransfers';
import { ClassOpenings } from './ClassOpenings';
import { ClassReconciliation } from './ClassReconciliation';
import { ClassRegister } from '@pages/company/ledger/shared/ClassRegister';
import { CompanyPeople } from './CompanyPeople';
import { ClassInspectionCopy } from './ClassInspectionCopy';
import { CompanyMemberAccess } from './CompanyMemberAccess';
import { CompanyPack } from './CompanyPack';
import { RegisterLinks } from './RegisterLinks';
import { RegisterParticulars } from './RegisterParticulars';
import { RegisterSetup } from './RegisterSetup';
import { useCompanyRegister, useRegisterDownload } from '@pages/company/shared/useCompanyRegister';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { useLedgerNavigation } from '@components/LedgerNavigation';

const ON_CHAIN = ['deployed', 'paused'];
function RegisterPage({
  companyName,
  sections,
  task,
  children,
}: {
  companyName?: string;
  sections?: ReactNode;
  task?: LedgerTask;
  children: ReactNode;
}) {
  const { hash } = useLocation();
  const hashTask = hash.slice(1);
  const documents = documentView(hashTask);
  const shownTask = task ?? ledgerTask(hashTask);
  const title = pageTitle('companyRegister', shownTask ?? hashTask);
  return (
    <PageTitle.Provider value={title}>
      <Page
        lede={
          shownTask === 'issue'
            ? 'Record a company-approved share issue.'
            : shownTask === 'transfer'
              ? 'Record a transfer between shareholders.'
              : shownTask === 'corrections'
                ? 'Prepare and review changes while preserving the original records.'
                : hash === '#awards'
                  ? 'Record employee entitlements and vesting. Shares are issued through a separate company decision.'
                  : documents === 'ledger-exports'
                    ? 'Download ledger records or prepare an inspection copy.'
                    : documents === 'company-pack'
                      ? 'Prepare a package of the company’s records.'
                      : hash === '#shareholders'
                        ? 'Who holds shares and what they hold in each class.'
                        : hash === '#member-access'
                          ? 'Invite people to their records and manage their access.'
                          : hash === '#member-requests'
                            ? 'Review requests to update details or prepare certificates.'
                            : 'Share classes and current ownership.'
        }
      >
        {companyName && <p className="text-sm text-text-muted">{companyName}</p>}
        {children}
        {sections}
      </Page>
    </PageTitle.Provider>
  );
}

function RegisterDownload({ register }: { register: TokenHoldersResponse }) {
  const download = useRegisterDownload(register.token.uuid, register.token.symbol);
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">{REGISTER_COPY.PRIVACY_NOTE}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <PageAction
          label={REGISTER_COPY.DOWNLOAD}
          onClick={() => download.mutate()}
          disabled={!register.initialized}
          busy={download.isPending}
          busyLabel="Downloading…"
        />
      </div>
      {download.isError && (
        <p role="alert" className="text-sm text-error-light">
          {REGISTER_COPY.DOWNLOAD_FAILED}
        </p>
      )}
    </div>
  );
}

export default function CompanyRegisterPage() {
  const location = useLocation();
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  if (location.hash === '#certificates' || location.hash === '#documents')
    return <Navigate to={certificatesLocation(location)} state={location.state} replace />;
  if (owner)
    return (
      <OwnRegister key={`${owner.userUuid}/${owner.ownerAccountUuid}`} owner={owner} currentOwner={boundary.get} />
    );
  return (
    <RegisterPage>
      {preferences.isLoading ? (
        <Loading>Loading your account…</Loading>
      ) : (
        <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
          Your account could not be loaded.
        </LoadError>
      )}
    </RegisterPage>
  );
}

function OwnRegister({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const { setState: setLedgerNavigation } = useLedgerNavigation();
  const companyContext = useCompanyContext();
  const [memberHeldView, setMemberHeldView] = useState<'access' | 'requests' | null>(null);
  const memberHeld = memberHeldView !== null;
  const memberHeldChange = useCallback((held: boolean, view: 'access' | 'requests') => {
    setMemberHeldView(held ? view : null);
  }, []);
  const [personHeld, setPersonHeld] = useState(false);
  const [documentTask, setDocumentTask] = useState<string | null>(null);
  const [particularsReviewCompany, setParticularsReviewCompany] = useState<string | null>(null);
  const particularsReviewChanged = useCallback((company: string, open: boolean) => {
    setParticularsReviewCompany((current) => (open ? company : current === company ? null : current));
  }, []);
  const documentEditing = useCallback((task: string, open: boolean) => {
    setDocumentTask((current) => (open ? task : current === task ? null : current));
  }, []);
  const location = useLocation();
  const navigate = useNavigate();
  const { hash } = location;
  const documents = documentView(hash.slice(1));
  useEffect(() => {
    if (location.hash !== '#history') return;
    navigate(
      { pathname: location.pathname, search: location.search, hash: '#corrections' },
      { replace: true, state: location.state },
    );
  }, [location, navigate]);
  const includeEmptyCompanies =
    ['#shareholders', '#member-access', '#member-requests'].includes(hash) || documents === 'company-pack';
  const [heldClasses, setHeldClasses] = useState<ReadonlySet<string>>(() => new Set());
  const [editingAwards, setEditingAwards] = useState<ReadonlySet<string>>(() => new Set());
  const awardEditing = useCallback((token: string, editing: boolean) => {
    setEditingAwards((current) => {
      if (current.has(token) === editing) return current;
      const next = new Set(current);
      if (editing) next.add(token);
      else next.delete(token);
      return next;
    });
  }, []);
  const [taskSelection, setTaskSelection] = useState<{
    company: string;
    token: string;
    task: LedgerTask | 'awards' | DocumentView;
    locationKey: string;
  } | null>(null);
  const [retainedScope, setRetainedScope] = useState<{
    company: { uuid: string; name: string };
    registers: TokenHoldersResponse[];
  } | null>(null);
  const held = memberHeld || personHeld || heldClasses.size > 0;
  const retained =
    held && retainedScope
      ? { company: retainedScope.company, tokens: retainedScope.registers.map(({ token }) => token.uuid) }
      : undefined;
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const registerToken = typeof location.state?.registerToken === 'string' ? location.state.registerToken : '';
  const statedCompany =
    typeof location.state?.registerCompany === 'string' ? location.state.registerCompany : undefined;
  const requestedCompany =
    new URLSearchParams(location.search).get('company') ??
    statedCompany ??
    (registerToken ? undefined : companyContext ? (companyContext.companyUuid ?? '') : undefined);
  const includeCompanyAppointments = includeEmptyCompanies || !!companyContext?.companyUuid;
  const { classes, companies, company, registers, companyAppointments } = useCompanyRegister(
    owner,
    guard,
    retained,
    includeCompanyAppointments,
    requestedCompany,
    registerToken,
  );
  const companiesReady =
    !includeCompanyAppointments ||
    classes.data?.some((item) => item.companyUuid === company?.uuid) ||
    companyAppointments.isSuccess;
  const preferenceRead = useUserPreferences();
  const client = useQueryClient();
  const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const scope =
    held && retainedScope
      ? { company: retainedScope.company, registers: registers.data ?? retainedScope.registers }
      : company && registers.data
        ? { company, registers: registers.data }
        : null;
  const reviewingParticulars = !!scope && particularsReviewCompany === scope.company.uuid;
  const appointments = useOwnAppointments(owner, guard, { enabled: !!scope });
  const readable =
    preferences?.status === 'success' &&
    companiesReady &&
    classes.isSuccess &&
    registers.isSuccess &&
    !!scope &&
    scope.registers.every(({ token }) =>
      classes.data.some((item) => item.uuid === token.uuid && item.companyUuid === scope.company.uuid),
    );
  const sourceReady =
    readable &&
    preferences?.fetchStatus === 'idle' &&
    classes.fetchStatus === 'idle' &&
    registers.fetchStatus === 'idle';
  let ownershipReady = false;
  let ownershipInvalid = false;
  if (sourceReady && scope) {
    try {
      const expected = classes.data.filter((item) => item.companyUuid === scope.company.uuid);
      if (scope.registers.length !== expected.length)
        throw new Error('The company register did not include every share class.');
      ownershipSummary(scope.registers);
      ownershipReady = true;
    } catch {
      ownershipInvalid = true;
    }
  }
  if (
    !held &&
    sourceReady &&
    scope &&
    (retainedScope?.company.uuid !== scope.company.uuid || retainedScope.registers !== scope.registers)
  )
    setRetainedScope(scope);
  const classHeld = useCallback((token: string, held: boolean) => {
    setHeldClasses((current) => {
      if (current.has(token) === held) return current;
      const next = new Set(current);
      if (held) next.add(token);
      else next.delete(token);
      return next;
    });
  }, []);
  const allotmentHeld = useCallback(
    (token: string, held: boolean) => classHeld(`allotments/${token}`, held),
    [classHeld],
  );
  const awardHeld = useCallback((token: string, held: boolean) => classHeld(`awards/${token}`, held), [classHeld]);
  const grantHeld = useCallback((token: string, held: boolean) => classHeld(`grants/${token}`, held), [classHeld]);
  const transferHeld = useCallback(
    (token: string, uuid: string, held: boolean) => classHeld(`transfer/${token}/${uuid}`, held),
    [classHeld],
  );
  const correctionHeld = useCallback(
    (token: string, uuid: string, held: boolean) => classHeld(`corrections/${token}/${uuid}`, held),
    [classHeld],
  );
  const companyCorrectionHeld = useCallback(
    (uuid: string, held: boolean) => classHeld(`corrections/company/${uuid}`, held),
    [classHeld],
  );
  const registerCompany =
    new URLSearchParams(location.search).get('company') ??
    statedCompany ??
    classes.data?.find((item) => item.uuid === registerToken)?.companyUuid ??
    companyContext?.companyUuid ??
    '';
  const hashTask = hash.slice(1);
  const registerTask = ledgerTask(hashTask) ?? ledgerTask(location.state?.registerTask);
  const registerOutcome =
    typeof location.state?.registerOutcome === 'string' ? location.state.registerOutcome : undefined;
  const inviteMember = typeof location.state?.inviteMember === 'string' ? location.state.inviteMember : undefined;
  const issueMember = typeof location.state?.issueMember === 'string' ? location.state.issueMember : undefined;
  const issueAward = typeof location.state?.issueAward === 'string' ? location.state.issueAward : undefined;
  const registerRecord = typeof location.state?.registerRecord === 'string' ? location.state.registerRecord : undefined;
  const landed: Landed | undefined = registerRecord
    ? { record: registerRecord, key: location.key, outcome: registerOutcome }
    : undefined;
  const view =
    hash === '#awards'
      ? 'awards'
      : documents
        ? 'documents'
        : hash === '#shareholders'
          ? 'shareholders'
          : hash === '#member-access'
            ? 'member-access'
            : hash === '#member-requests'
              ? 'member-requests'
              : 'register';
  const heldShareholderView = personHeld
    ? 'shareholders'
    : memberHeldView === 'access'
      ? 'member-access'
      : memberHeldView === 'requests'
        ? 'member-requests'
        : [...heldClasses].some((key) => key.startsWith('awards/'))
          ? 'awards'
          : undefined;
  const requestedToken =
    scope && scope.company.uuid === registerCompany && scope.registers.some(({ token }) => token.uuid === registerToken)
      ? registerToken
      : undefined;
  const taskToken =
    requestedToken ??
    (scope &&
    (ledgerTask(hashTask) ||
      hashTask === 'awards' ||
      documents ||
      (registerTask && scope.company.uuid === registerCompany))
      ? scope.registers[0]?.token.uuid
      : undefined);
  const localSelection =
    taskSelection?.company === scope?.company.uuid && taskSelection?.locationKey === location.key
      ? taskSelection
      : null;
  const pinned = [...heldClasses].find((key) =>
    ['allotments/', 'grants/', 'transfer/', 'corrections/', 'awards/'].some((prefix) => key.startsWith(prefix)),
  );
  const pinnedParts = pinned?.split('/');
  const selectedTask =
    pinnedParts?.[0] === 'allotments' || pinnedParts?.[0] === 'grants'
      ? 'issue'
      : pinnedParts?.[0] === 'transfer'
        ? 'transfer'
        : pinnedParts?.[0] === 'corrections'
          ? 'corrections'
          : ledgerTask(localSelection?.task ?? (taskToken ? registerTask : undefined));
  const candidateToken =
    pinnedParts && pinnedParts[1] !== 'company'
      ? pinnedParts[1]
      : view === 'awards' && editingAwards.size > 0
        ? [...editingAwards][0]
        : (localSelection?.token ?? taskToken);
  const selectedToken = scope?.registers.some(({ token }) => token.uuid === candidateToken)
    ? candidateToken
    : scope?.registers[0]?.token.uuid;
  const canAddClass =
    !held &&
    sourceReady &&
    !!scope &&
    appointments.isSuccess &&
    !appointments.isFetching &&
    !!appointmentForRegisterStep(appointments.data, scope.company.uuid, 'prepare');
  useEffect(() => {
    setLedgerNavigation({
      company: scope?.company.uuid,
      token: selectedToken,
      task: selectedTask,
      shareholderView: heldShareholderView,
      blocked: held || !sourceReady,
      held,
    });
    return () => setLedgerNavigation(null);
  }, [setLedgerNavigation, scope?.company.uuid, selectedToken, selectedTask, heldShareholderView, held, sourceReady]);
  const classSections = useRef(new Map<string, HTMLLIElement>());
  const focusedContext = useRef('');
  useEffect(() => {
    if (
      focusedContext.current === location.key ||
      held ||
      !sourceReady ||
      includeEmptyCompanies ||
      (view === 'register' && !selectedTask) ||
      !registerToken ||
      scope?.company.uuid !== registerCompany ||
      !scope.registers.some(({ token }) => token.uuid === registerToken)
    )
      return;
    const section = classSections.current.get(registerToken);
    if (!section) return;
    if (!registerRecord) {
      section.focus({ preventScroll: true });
      section.scrollIntoView?.({ block: 'start' });
    }
    focusedContext.current = location.key;
  }, [
    location.key,
    held,
    sourceReady,
    view,
    includeEmptyCompanies,
    selectedTask,
    registerToken,
    registerRecord,
    registerCompany,
    scope,
  ]);

  return (
    <RegisterPage
      task={view === 'register' ? selectedTask : undefined}
      companyName={readable && sourceReady ? scope?.company.name : undefined}
      sections={
        scope && (
          <>
            <div
              hidden={
                (view !== 'member-access' && view !== 'member-requests') || (memberHeld && view !== heldShareholderView)
              }
            >
              <CompanyMemberAccess
                key={`members/${scope.company.uuid}`}
                view={view === 'member-requests' ? 'requests' : 'access'}
                owner={owner}
                guard={guard}
                company={scope.company.uuid}
                registers={scope.registers}
                sourceReady={sourceReady}
                inviteMember={inviteMember}
                onHeldChange={memberHeldChange}
              />
            </div>
            <div hidden={view !== 'register' || selectedTask !== 'corrections'}>
              <RegisterParticulars
                key={`particulars/${scope.company.uuid}`}
                landed={landed}
                owner={owner}
                guard={guard}
                company={scope.company.uuid}
                registers={scope.registers}
                visible={view === 'register' && selectedTask === 'corrections' && sourceReady}
                onHeldChange={companyCorrectionHeld}
                onReviewChange={particularsReviewChanged}
              />
              <div hidden={reviewingParticulars}>
                <RegisterLinks
                  landed={landed}
                  owner={owner}
                  guard={guard}
                  company={scope.company.uuid}
                  registers={scope.registers}
                  visible={view === 'register' && selectedTask === 'corrections' && sourceReady}
                  onHeldChange={companyCorrectionHeld}
                />
              </div>
            </div>
            <div hidden={documents !== 'company-pack'}>
              {readable && (
                <CompanyPack
                  owner={owner}
                  guard={guard}
                  company={scope.company.uuid}
                  sourceReady={sourceReady && documents === 'company-pack'}
                  onEditingChange={documentEditing}
                />
              )}
            </div>
          </>
        )
      }
    >
      {preferenceRead.isError ? (
        <LoadError retry={() => preferenceRead.refetch()} busy={preferenceRead.isFetching}>
          Your account could not be loaded.
        </LoadError>
      ) : includeCompanyAppointments && companyAppointments.isError && !companiesReady ? (
        <LoadError retry={() => companyAppointments.refetch()} busy={companyAppointments.isFetching}>
          The companies could not be loaded.
        </LoadError>
      ) : preferenceRead.isFetching || classes.isPending || !companiesReady ? (
        <Loading>Loading the register…</Loading>
      ) : classes.isError || registers.isError || (held && !sourceReady) ? (
        <LoadError
          retry={() => {
            void classes.refetch();
            void registers.refetch();
          }}
          busy={classes.isFetching || registers.isFetching}
        >
          The register could not be loaded.
        </LoadError>
      ) : !company && companyContext ? (
        <CompanyContextNotice />
      ) : companies.length === 0 ? (
        <RegisterSetup owner={owner} guard={guard} />
      ) : !company ? (
        <CompanyContextNotice />
      ) : registers.isPending ? (
        <Loading>Loading the register…</Loading>
      ) : null}
      {scope && (view === 'register' || view === 'shareholders') && ownershipInvalid && (
        <LoadError
          retry={() => {
            void classes.refetch();
            void registers.refetch();
          }}
          busy={classes.isFetching || registers.isFetching}
        >
          The register could not be loaded.
        </LoadError>
      )}
      {scope && personHeld && view !== 'shareholders' && (
        <div className="space-y-3">
          <p role="status" className="text-sm text-text-muted">
            A person save is unfinished. Return to its original form to finish it.
          </p>
          <PageLink
            to={`${DESTINATIONS.companyRegister.path}?company=${scope.company.uuid}#shareholders`}
            state={{ registerCompany: scope.company.uuid }}
            label="Return to person form"
          />
        </div>
      )}
      {scope && memberHeld && view !== heldShareholderView && (
        <div className="space-y-3">
          <p role="status" className="text-sm text-text-muted">
            A member action is unfinished. Return to its original form to finish it.
          </p>
          <PageLink
            to={`${DESTINATIONS.companyRegister.path}?company=${scope.company.uuid}#${heldShareholderView}`}
            state={{ registerCompany: scope.company.uuid }}
            label="Return to member action"
          />
        </div>
      )}
      {scope && ((includeEmptyCompanies && ownershipReady) || personHeld) && (
        <div hidden={view !== 'shareholders'}>
          <CompanyPeople
            key={scope.company.uuid}
            owner={owner}
            guard={guard}
            registers={scope.registers}
            company={scope.company.uuid}
            blocked={held}
            sourceReady={sourceReady}
            onHeldChange={setPersonHeld}
          />
        </div>
      )}
      {scope && (view === 'register' || view === 'awards' || documents === 'ledger-exports') && (
        <>
          {view === 'register' && !selectedTask && ownershipReady && scope.registers.length === 0 && (
            <Section title="Share classes">
              <p className="text-sm text-text-muted">No share classes yet.</p>
            </Section>
          )}
          {view === 'register' &&
            !selectedTask &&
            ownershipReady &&
            scope.registers.map((register) => (
              <Section key={register.token.uuid} title={`${register.token.name} · ${register.token.symbol}`}>
                <ClassRegister register={register} former={false} />
                {held ? (
                  <PageAction label="Class details" context={register.token.name} disabled onClick={() => undefined} />
                ) : (
                  <PageLink
                    to={`${generatePath(DESTINATIONS.companyClass.path, { uuid: register.token.uuid })}?company=${scope.company.uuid}`}
                    label="Class details"
                    context={register.token.name}
                  />
                )}
              </Section>
            ))}
          {view === 'register' && !selectedTask && canAddClass && (
            <div className="flex flex-wrap justify-end gap-2">
              <PageLink
                primary
                to={`${DESTINATIONS.companyRegisterSetup.path}?company=${scope.company.uuid}`}
                label="Add share class"
              />
            </div>
          )}
          <section
            aria-label={documents ? 'Document scope' : 'Ledger tasks'}
            hidden={reviewingParticulars}
            className="space-y-4"
          >
            {(selectedTask || view === 'awards' || documents) && sourceReady && scope.registers.length === 1 && (
              <p className="text-sm text-text-muted">
                {scope.registers[0].token.name} · {scope.registers[0].token.symbol}
              </p>
            )}
            {(selectedTask || view === 'awards' || documents) && sourceReady && scope.registers.length > 1 && (
              <div className="max-w-sm">
                <SelectField
                  label="Share class"
                  options={scope.registers.map(({ token }) => ({
                    value: token.uuid,
                    label: `${token.name} · ${token.symbol}`,
                  }))}
                  value={selectedToken}
                  disabled={held || (view === 'awards' && editingAwards.size > 0)}
                  onChange={(token) => {
                    if (!held && (view !== 'awards' || editingAwards.size === 0) && sourceReady)
                      setTaskSelection({
                        company: scope.company.uuid,
                        token,
                        task: documents ?? (view === 'awards' ? 'awards' : selectedTask!),
                        locationKey: location.key,
                      });
                  }}
                />
              </div>
            )}
          </section>
        </>
      )}
      {scope && (
        <ul hidden={includeEmptyCompanies || reviewingParticulars} className="space-y-6">
          {scope.registers.map((register) => (
            <li
              key={register.token.uuid}
              hidden={
                ((view === 'awards' || view === 'documents') && selectedToken !== register.token.uuid) ||
                documents === 'company-pack' ||
                (view === 'documents' && !!documentTask && documentTask !== `inspection/${register.token.uuid}`)
              }
              tabIndex={-1}
              className="scroll-mt-6"
              ref={(section) => {
                if (section) classSections.current.set(register.token.uuid, section);
                else classSections.current.delete(register.token.uuid);
              }}
            >
              <section
                data-register-tasks
                hidden={view === 'register' && (!selectedTask || selectedToken !== register.token.uuid)}
                className={
                  (view === 'register' && selectedTask) || view === 'awards' || view === 'documents'
                    ? 'space-y-5'
                    : 'space-y-5 rounded-xl border border-border bg-surface-raised p-4 sm:p-5'
                }
              >
                <h2
                  hidden={
                    view === 'awards' ||
                    view === 'documents' ||
                    (sourceReady && view === 'register' && (selectedTask === 'issue' || selectedTask === 'transfer'))
                  }
                  className={
                    sourceReady && view === 'register' && selectedTask === 'corrections'
                      ? 'sr-only'
                      : 'break-words font-display text-xl tracking-[-0.01em] text-text-primary'
                  }
                >
                  {sourceReady ? `${register.token.name} · ${register.token.symbol}` : 'Ledger task recovery'}
                </h2>
                <div className="space-y-5">
                  <div hidden={view !== 'register' || selectedTask !== 'issue'}>
                    <ClassIssues
                      key={`issues/${scope.company.uuid}/${register.token.uuid}`}
                      owner={owner}
                      guard={guard}
                      register={register}
                      company={scope.company.uuid}
                      sourceReady={sourceReady}
                      visible={view === 'register' && selectedTask === 'issue' && selectedToken === register.token.uuid}
                      onAllotmentHeld={allotmentHeld}
                      onGrantHeld={grantHeld}
                      request={
                        register.token.uuid === requestedToken
                          ? { key: location.key, member: issueMember, award: issueAward, record: registerRecord }
                          : undefined
                      }
                    />
                  </div>
                  <div hidden={view !== 'register' || selectedTask !== 'transfer'}>
                    <ClassTransfers
                      landed={landed}
                      owner={owner}
                      guard={guard}
                      register={register}
                      company={scope.company.uuid}
                      visible={
                        view === 'register' &&
                        selectedTask === 'transfer' &&
                        selectedToken === register.token.uuid &&
                        sourceReady
                      }
                      onHeldChange={transferHeld}
                    />
                  </div>
                  <div hidden={view !== 'register' || selectedTask !== 'corrections'}>
                    <Section title="Changes">
                      <ClassCorrections
                        landed={landed}
                        owner={owner}
                        guard={guard}
                        token={register.token.uuid}
                        company={scope.company.uuid}
                        register={register}
                        sourceReady={sourceReady}
                        visible={
                          view === 'register' &&
                          selectedTask === 'corrections' &&
                          selectedToken === register.token.uuid &&
                          sourceReady
                        }
                        onHeldChange={correctionHeld}
                      />
                      <ClassImports
                        owner={owner}
                        guard={guard}
                        register={register}
                        company={scope.company.uuid}
                        visible={
                          view === 'register' &&
                          selectedTask === 'corrections' &&
                          selectedToken === register.token.uuid &&
                          sourceReady
                        }
                        onHeldChange={correctionHeld}
                      />
                      {ON_CHAIN.includes(register.token.status) && (
                        <ClassOpenings
                          landed={landed}
                          owner={owner}
                          guard={guard}
                          register={register}
                          company={scope.company.uuid}
                          visible={
                            view === 'register' &&
                            selectedTask === 'corrections' &&
                            selectedToken === register.token.uuid &&
                            sourceReady
                          }
                          onHeldChange={correctionHeld}
                        />
                      )}
                      <ClassReconciliation
                        owner={owner}
                        guard={guard}
                        token={register.token.uuid}
                        company={scope.company.uuid}
                        holders={register.holders}
                        status={register.token.status}
                        visible={
                          view === 'register' &&
                          selectedTask === 'corrections' &&
                          selectedToken === register.token.uuid &&
                          sourceReady
                        }
                        onHeldChange={correctionHeld}
                      />
                    </Section>
                  </div>
                  <div hidden={view !== 'awards'} className="space-y-5">
                    <ClassAwards
                      key={`${scope.company.uuid}/${register.token.uuid}`}
                      owner={owner}
                      guard={guard}
                      register={register}
                      company={scope.company.uuid}
                      sourceReady={sourceReady}
                      onHeldChange={awardHeld}
                      onEditingChange={awardEditing}
                      active={view === 'awards' && selectedToken === register.token.uuid}
                    />
                  </div>
                  <div hidden={view !== 'documents'} className="space-y-5">
                    {readable && (
                      <>
                        <div hidden={documents !== 'ledger-exports' || !!documentTask}>
                          <Section title="CSV download">
                            <RegisterDownload register={register} />
                          </Section>
                        </div>
                        <div
                          hidden={
                            documents !== 'ledger-exports' ||
                            (!!documentTask && documentTask !== `inspection/${register.token.uuid}`)
                          }
                        >
                          <Section title="Inspection copy">
                            <ClassInspectionCopy
                              register={register}
                              guard={guard}
                              sourceReady={
                                sourceReady &&
                                documents === 'ledger-exports' &&
                                selectedToken === register.token.uuid &&
                                (!documentTask || documentTask === `inspection/${register.token.uuid}`)
                              }
                              onEditingChange={documentEditing}
                            />
                          </Section>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </section>
            </li>
          ))}
        </ul>
      )}
    </RegisterPage>
  );
}

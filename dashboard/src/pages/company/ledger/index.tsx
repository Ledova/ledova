import { SelectField } from '@components/SelectField';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { generatePath, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_COPY,
  appointmentForRegisterStep,
  isLedgerTask,
  ownershipSummary,
  useSubmissionOwner,
  useUserPreferences,
  USER_PREFERENCES_QUERY_KEY,
  type LedgerTask,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LoadError, Loading, Section } from '@components/Ledger';
import { PageTitle } from '@components/PageTitle';
import { pageTitle } from '@utils/destinations';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';
import { Page, PageAction, PageLink } from '@components/Page';
import { CompanySelection } from '@pages/company/shared/CompanySelection';

import { ClassCorrections } from './ClassCorrections';
import { ClassEntries } from './ClassEntries';
import { ClassCertificates } from './ClassCertificates';
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
  selection,
  companyName,
  sections,
  task,
  children,
}: {
  selection?: ReactNode;
  companyName?: string;
  sections?: ReactNode;
  task?: LedgerTask;
  children: ReactNode;
}) {
  const { hash } = useLocation();
  const hashTask = hash.slice(1);
  const shownTask = task ?? (isLedgerTask(hashTask) ? hashTask : undefined);
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
                : shownTask === 'history'
                  ? 'Recorded changes and their supporting records.'
                  : hash === '#awards'
                    ? 'Record employee entitlements and vesting. Shares are issued through a separate company decision.'
                    : hash === '#documents'
                      ? 'Prepare permitted register copies, certificates and company packs.'
                      : hash === '#shareholders'
                        ? 'Who holds shares, what they hold in each class, and their access to their own records.'
                        : 'Share classes and current ownership.'
        }
      >
        {selection}
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
    <div className="flex flex-col items-start gap-2 border-b border-border-subtle py-3">
      <p className="text-sm text-text-muted">{REGISTER_COPY.PRIVACY_NOTE}</p>
      <PageAction
        label={REGISTER_COPY.DOWNLOAD}
        onClick={() => download.mutate()}
        disabled={!register.initialized}
        busy={download.isPending}
        busyLabel="Downloading…"
      />
      {download.isError && (
        <p role="alert" className="text-sm text-error-light">
          {REGISTER_COPY.DOWNLOAD_FAILED}
        </p>
      )}
    </div>
  );
}

export default function CompanyRegisterPage() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
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
  const [memberHeld, setMemberHeld] = useState(false);
  const [memberEditing, setMemberEditing] = useState(false);
  const [personHeld, setPersonHeld] = useState(false);
  const [documentTask, setDocumentTask] = useState<string | null>(null);
  const documentEditing = useCallback((task: string, open: boolean) => {
    setDocumentTask((current) => (open ? task : current === task ? null : current));
  }, []);
  const location = useLocation();
  const { hash } = location;
  const includeEmptyCompanies = hash === '#shareholders';
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
    task: LedgerTask;
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
  const { classes, companies, company, selectCompany, registers, companyAppointments } = useCompanyRegister(
    owner,
    guard,
    retained,
    includeEmptyCompanies,
  );
  const companiesReady =
    !includeEmptyCompanies ||
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
  const registerToken = typeof location.state?.registerToken === 'string' ? location.state.registerToken : '';
  const registerCompany =
    typeof location.state?.registerCompany === 'string'
      ? location.state.registerCompany
      : (classes.data?.find((item) => item.uuid === registerToken)?.companyUuid ?? '');
  const hashTask = hash.slice(1);
  const registerTask = isLedgerTask(hashTask)
    ? hashTask
    : isLedgerTask(location.state?.registerTask)
      ? location.state.registerTask
      : undefined;
  const registerOutcome =
    typeof location.state?.registerOutcome === 'string' ? location.state.registerOutcome : undefined;
  const inviteMember = typeof location.state?.inviteMember === 'string' ? location.state.inviteMember : undefined;
  const issueMember = typeof location.state?.issueMember === 'string' ? location.state.issueMember : undefined;
  const issueAward = typeof location.state?.issueAward === 'string' ? location.state.issueAward : undefined;
  const registerRecord = typeof location.state?.registerRecord === 'string' ? location.state.registerRecord : undefined;
  const landed: Landed | undefined = registerRecord
    ? { record: registerRecord, key: location.key, outcome: registerOutcome }
    : undefined;
  const enteredIssue = useRef('');
  const entered = `${registerCompany}/${registerToken}`;
  useEffect(() => {
    if (enteredIssue.current === entered || !classes.isSuccess || classes.isFetching || held || !companiesReady) return;
    if (
      registerCompany &&
      (includeEmptyCompanies && !registerToken
        ? companies.some((item) => item.uuid === registerCompany)
        : classes.data.some(
            (item) => item.companyUuid === registerCompany && (!registerToken || item.uuid === registerToken),
          ))
    )
      selectCompany(registerCompany);
    enteredIssue.current = entered;
  }, [
    enteredIssue,
    entered,
    classes.isSuccess,
    classes.isFetching,
    classes.data,
    held,
    registerToken,
    registerCompany,
    selectCompany,
    companiesReady,
    includeEmptyCompanies,
    companies,
  ]);
  const view =
    hash === '#awards'
      ? 'awards'
      : hash === '#documents'
        ? 'documents'
        : hash === '#shareholders'
          ? 'shareholders'
          : 'register';
  const requestedToken =
    scope && scope.company.uuid === registerCompany && scope.registers.some(({ token }) => token.uuid === registerToken)
      ? registerToken
      : undefined;
  const taskToken =
    requestedToken ??
    (scope && (isLedgerTask(hashTask) || (registerTask && scope.company.uuid === registerCompany))
      ? scope.registers[0]?.token.uuid
      : undefined);
  const localSelection =
    taskSelection?.company === scope?.company.uuid && taskSelection?.locationKey === location.key
      ? taskSelection
      : null;
  const pinned = [...heldClasses].find((key) =>
    ['allotments/', 'grants/', 'transfer/', 'corrections/'].some((prefix) => key.startsWith(prefix)),
  );
  const pinnedParts = pinned?.split('/');
  const selectedTask =
    pinnedParts?.[0] === 'allotments' || pinnedParts?.[0] === 'grants'
      ? 'issue'
      : pinnedParts?.[0] === 'transfer'
        ? 'transfer'
        : pinnedParts?.[0] === 'corrections'
          ? 'corrections'
          : (localSelection?.task ?? (taskToken ? registerTask : undefined));
  const candidateToken =
    pinnedParts && pinnedParts[1] !== 'company' ? pinnedParts[1] : (localSelection?.token ?? taskToken);
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
      blocked: held || !sourceReady,
    });
    return () => setLedgerNavigation(null);
  }, [setLedgerNavigation, scope?.company.uuid, selectedToken, selectedTask, held, sourceReady]);
  const classSections = useRef(new Map<string, HTMLLIElement>());
  const focusedContext = useRef('');
  useEffect(() => {
    if (
      focusedContext.current === location.key ||
      held ||
      !sourceReady ||
      view === 'shareholders' ||
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
  }, [location.key, held, sourceReady, view, selectedTask, registerToken, registerRecord, registerCompany, scope]);

  return (
    <RegisterPage
      task={view === 'register' ? selectedTask : undefined}
      companyName={readable && sourceReady ? scope?.company.name : undefined}
      selection={
        preferences?.status === 'success' &&
        preferences.fetchStatus === 'idle' &&
        classes.isSuccess &&
        !classes.isFetching &&
        (!held || readable) &&
        companies.length > 1 && (
          <CompanySelection
            read={{
              companies,
              companyUuid: scope?.company.uuid,
              selectionBlocked: held,
              selectCompany,
            }}
          />
        )
      }
      sections={
        scope && (
          <>
            <div hidden={view !== 'shareholders'}>
              <CompanyMemberAccess
                key={`members/${scope.company.uuid}`}
                owner={owner}
                guard={guard}
                company={scope.company.uuid}
                registers={scope.registers}
                sourceReady={sourceReady}
                inviteMember={inviteMember}
                onHeldChange={setMemberHeld}
                onEditingChange={setMemberEditing}
              />
            </div>
            <div hidden={view !== 'register' || !['history', 'corrections'].includes(selectedTask ?? '')}>
              <RegisterParticulars
                landed={landed}
                owner={owner}
                guard={guard}
                company={scope.company.uuid}
                registers={scope.registers}
                readOnly={selectedTask !== 'corrections'}
                visible={view === 'register' && ['history', 'corrections'].includes(selectedTask ?? '') && sourceReady}
                onHeldChange={companyCorrectionHeld}
              />
              <RegisterLinks
                landed={landed}
                owner={owner}
                guard={guard}
                company={scope.company.uuid}
                registers={scope.registers}
                readOnly={selectedTask !== 'corrections'}
                visible={view === 'register' && ['history', 'corrections'].includes(selectedTask ?? '') && sourceReady}
                onHeldChange={companyCorrectionHeld}
              />
            </div>
            <div hidden={view !== 'documents' || (!!documentTask && documentTask !== `pack/${scope.company.uuid}`)}>
              {readable && (
                <CompanyPack
                  owner={owner}
                  guard={guard}
                  company={scope.company.uuid}
                  sourceReady={sourceReady && view === 'documents'}
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
      ) : includeEmptyCompanies && companyAppointments.isError && !companiesReady ? (
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
      ) : companies.length === 0 ? (
        <RegisterSetup owner={owner} guard={guard} />
      ) : !company ? (
        <p className="py-3 text-sm text-text-muted">Select a company to show its register.</p>
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
            to={`${DESTINATIONS.companyRegister.path}#shareholders`}
            state={{ registerCompany: scope.company.uuid }}
            label="Return to person form"
          />
        </div>
      )}
      {scope && ((view === 'shareholders' && ownershipReady) || personHeld) && (
        <div hidden={view !== 'shareholders' || memberEditing}>
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
      {scope && view === 'register' && (
        <>
          {!selectedTask &&
            ownershipReady &&
            scope.registers.map((register) => (
              <Section key={register.token.uuid} title={`${register.token.name} · ${register.token.symbol}`}>
                <ClassRegister register={register} former={false} />
                {held ? (
                  <PageAction label="Class details" context={register.token.name} disabled onClick={() => undefined} />
                ) : (
                  <PageLink
                    to={generatePath(DESTINATIONS.companyClass.path, { uuid: register.token.uuid })}
                    label="Class details"
                    context={register.token.name}
                  />
                )}
              </Section>
            ))}
          {!selectedTask && canAddClass && (
            <div className="flex flex-wrap justify-end gap-2">
              <PageLink
                primary
                to={`${DESTINATIONS.companyRegisterSetup.path}?company=${scope.company.uuid}`}
                label="Add share class"
              />
            </div>
          )}
          <section aria-label="Ledger tasks" className="space-y-4">
            {selectedTask && sourceReady && scope.registers.length === 1 && (
              <p className="text-sm text-text-muted">
                {scope.registers[0].token.name} · {scope.registers[0].token.symbol}
              </p>
            )}
            {selectedTask && sourceReady && scope.registers.length > 1 && (
              <div className="max-w-sm">
                <SelectField
                  label="Share class"
                  options={scope.registers.map(({ token }) => ({
                    value: token.uuid,
                    label: `${token.name} · ${token.symbol}`,
                  }))}
                  value={selectedToken}
                  disabled={held}
                  onChange={(token) => {
                    if (!held && sourceReady)
                      setTaskSelection({
                        company: scope.company.uuid,
                        token,
                        task: selectedTask,
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
        <ul hidden={view === 'shareholders'} className="space-y-6">
          {scope.registers.map((register) => (
            <li
              key={register.token.uuid}
              hidden={
                view === 'documents' &&
                !!documentTask &&
                documentTask !== `inspection/${register.token.uuid}` &&
                !documentTask.startsWith(`certificate/${register.token.uuid}/`)
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
                  (view === 'register' && selectedTask) || view === 'awards'
                    ? 'space-y-5'
                    : 'space-y-5 rounded-xl border border-border bg-surface-raised p-4 sm:p-5'
                }
              >
                <h2
                  hidden={
                    view === 'awards' ||
                    (sourceReady && view === 'register' && (selectedTask === 'issue' || selectedTask === 'transfer'))
                  }
                  className={
                    sourceReady && view === 'register' && ['history', 'corrections'].includes(selectedTask ?? '')
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
                  <div hidden={view !== 'register' || !['history', 'corrections'].includes(selectedTask ?? '')}>
                    <Section title={selectedTask === 'corrections' ? 'Corrections' : 'Changes'}>
                      <ClassEntries
                        owner={owner}
                        guard={guard}
                        company={scope.company.uuid}
                        register={register}
                        sourceReady={sourceReady}
                        visible={
                          view === 'register' &&
                          selectedTask === 'history' &&
                          selectedToken === register.token.uuid &&
                          sourceReady
                        }
                      />
                      <ClassCorrections
                        readOnly={selectedTask !== 'corrections'}
                        landed={landed}
                        owner={owner}
                        guard={guard}
                        token={register.token.uuid}
                        company={scope.company.uuid}
                        register={register}
                        sourceReady={sourceReady}
                        visible={
                          view === 'register' &&
                          ['history', 'corrections'].includes(selectedTask ?? '') &&
                          selectedToken === register.token.uuid &&
                          sourceReady
                        }
                        onHeldChange={correctionHeld}
                      />
                      <ClassImports
                        readOnly={selectedTask !== 'corrections'}
                        owner={owner}
                        guard={guard}
                        register={register}
                        company={scope.company.uuid}
                        visible={
                          view === 'register' &&
                          ['history', 'corrections'].includes(selectedTask ?? '') &&
                          selectedToken === register.token.uuid &&
                          sourceReady
                        }
                        onHeldChange={correctionHeld}
                      />
                      {ON_CHAIN.includes(register.token.status) && (
                        <ClassOpenings
                          readOnly={selectedTask !== 'corrections'}
                          landed={landed}
                          owner={owner}
                          guard={guard}
                          register={register}
                          company={scope.company.uuid}
                          visible={
                            view === 'register' &&
                            ['history', 'corrections'].includes(selectedTask ?? '') &&
                            selectedToken === register.token.uuid &&
                            sourceReady
                          }
                          onHeldChange={correctionHeld}
                        />
                      )}
                      <ClassReconciliation
                        readOnly={selectedTask !== 'corrections'}
                        owner={owner}
                        guard={guard}
                        token={register.token.uuid}
                        company={scope.company.uuid}
                        holders={register.holders}
                        status={register.token.status}
                        visible={
                          view === 'register' &&
                          ['history', 'corrections'].includes(selectedTask ?? '') &&
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
                      pauseFreshness={editingAwards.size > 0}
                      active={view === 'awards'}
                    />
                  </div>
                  <div hidden={view !== 'documents'} className="space-y-5">
                    <div hidden={!!documentTask && !documentTask.startsWith(`certificate/${register.token.uuid}/`)}>
                      <ClassCertificates
                        owner={owner}
                        guard={guard}
                        company={scope.company.uuid}
                        register={register}
                        sourceReady={sourceReady}
                        visible={
                          view === 'documents' &&
                          sourceReady &&
                          (!documentTask || documentTask.startsWith(`certificate/${register.token.uuid}/`))
                        }
                        activeTask={documentTask}
                        onEditingChange={documentEditing}
                      />
                    </div>
                    {readable && (
                      <>
                        <div hidden={!!documentTask}>
                          <RegisterDownload register={register} />
                        </div>
                        <div hidden={!!documentTask && documentTask !== `inspection/${register.token.uuid}`}>
                          <ClassInspectionCopy
                            register={register}
                            guard={guard}
                            sourceReady={
                              sourceReady &&
                              view === 'documents' &&
                              (!documentTask || documentTask === `inspection/${register.token.uuid}`)
                            }
                            onEditingChange={documentEditing}
                          />
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

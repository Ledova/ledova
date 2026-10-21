import { SelectField } from '@components/SelectField';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { generatePath, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_COPY,
  appointmentForRegisterStep,
  useSubmissionOwner,
  useUserPreferences,
  USER_PREFERENCES_QUERY_KEY,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LinkRow, LoadError, Loading } from '@components/Ledger';
import { PageTitle } from '@components/PageTitle';
import { pageTitle } from '@utils/destinations';
import { isRegisterTask, type Landed, type RegisterTask } from '@pages/company/register/shared/registerPlace';
import { Page, PageAction, PageLink } from '@components/Page';
import { CompanySelection } from '@pages/company/shared/CompanySelection';

import { ownershipSummary } from '@pages/company/shared/summary';
import { ClassCorrections } from './ClassCorrections';
import { ClassImports } from './ClassImports';
import { ClassIssues } from './ClassIssues';
import { ClassAwards } from './ClassAwards';
import { ClassTransfers } from './ClassTransfers';
import { ClassOpenings } from './ClassOpenings';
import { ClassReconciliation } from './ClassReconciliation';
import { ClassRegister, FormerShareholders } from '@pages/company/register/shared/ClassRegister';
import { CompanyShareholders } from '@pages/company/register/shared/CompanyShareholders';
import { ClassInspectionCopy } from './ClassInspectionCopy';
import { CompanyMemberAccess } from './CompanyMemberAccess';
import { CompanyPack } from './CompanyPack';
import { RegisterLinks } from './RegisterLinks';
import { RegisterParticulars } from './RegisterParticulars';
import { RegisterSetup } from './RegisterSetup';
import { useCompanyRegister, useRegisterDownload } from '@pages/company/shared/useCompanyRegister';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments } from '@hooks/useOwnAppointments';

const ON_CHAIN = ['deployed', 'paused'];
const TASKS = Object.entries(DESTINATIONS.companyRegister.tasks) as [RegisterTask, string][];

function RegisterPage({
  selection,
  companyName,
  actions,
  sections,
  children,
}: {
  selection?: ReactNode;
  companyName?: string;
  actions?: ReactNode;
  sections?: ReactNode;
  children: ReactNode;
}) {
  const { hash } = useLocation();
  const title = pageTitle('companyRegister', hash.slice(1));
  return (
    <PageTitle.Provider value={title}>
      <Page
        actions={actions}
        lede={
          hash === '#awards'
            ? 'Record employee entitlements and vesting. Shares are issued through a separate company decision.'
            : hash === '#documents'
              ? 'Prepare permitted register copies, certificates and company packs.'
              : hash === '#shareholders'
                ? 'Who holds shares, what they hold in each class, and their access to their own records.'
                : undefined
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
  const [memberHeld, setMemberHeld] = useState(false);
  const [heldClasses, setHeldClasses] = useState<ReadonlySet<string>>(() => new Set());
  const [taskSelection, setTaskSelection] = useState<{
    company: string;
    token: string;
    task: RegisterTask;
    locationKey: string;
  } | null>(null);
  const [retainedScope, setRetainedScope] = useState<{
    company: { uuid: string; name: string };
    registers: TokenHoldersResponse[];
  } | null>(null);
  const held = memberHeld || heldClasses.size > 0;
  const retained =
    held && retainedScope
      ? { company: retainedScope.company, tokens: retainedScope.registers.map(({ token }) => token.uuid) }
      : undefined;
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const { classes, companies, company, selectCompany, registers } = useCompanyRegister(owner, guard, retained);
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
  const historyHeld = useCallback(
    (token: string, uuid: string, held: boolean) => classHeld(`history/${token}/${uuid}`, held),
    [classHeld],
  );
  const companyHistoryHeld = useCallback(
    (uuid: string, held: boolean) => classHeld(`history/company/${uuid}`, held),
    [classHeld],
  );
  const location = useLocation();
  const { hash } = location;
  const registerToken = typeof location.state?.registerToken === 'string' ? location.state.registerToken : '';
  const registerCompany =
    typeof location.state?.registerCompany === 'string'
      ? location.state.registerCompany
      : (classes.data?.find((item) => item.uuid === registerToken)?.companyUuid ?? '');
  const registerTask = isRegisterTask(location.state?.registerTask) ? location.state.registerTask : undefined;
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
    if (enteredIssue.current === entered || !classes.isSuccess || classes.isFetching || held) return;
    if (
      registerCompany &&
      classes.data.some(
        (item) => item.companyUuid === registerCompany && (!registerToken || item.uuid === registerToken),
      )
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
    (registerTask && scope && scope.company.uuid === registerCompany ? scope.registers[0]?.token.uuid : undefined);
  const localSelection =
    taskSelection?.company === scope?.company.uuid && taskSelection?.locationKey === location.key
      ? taskSelection
      : null;
  const pinned = [...heldClasses].find((key) =>
    ['allotments/', 'grants/', 'transfer/', 'history/'].some((prefix) => key.startsWith(prefix)),
  );
  const pinnedParts = pinned?.split('/');
  const selectedTask =
    pinnedParts?.[0] === 'allotments' || pinnedParts?.[0] === 'grants'
      ? 'issue'
      : pinnedParts?.[0] === 'transfer'
        ? 'transfer'
        : pinnedParts?.[0] === 'history'
          ? 'history'
          : (localSelection?.task ?? (taskToken ? (registerTask ?? 'issue') : undefined));
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
  const chooseTask = (task: RegisterTask) => {
    if (held || !sourceReady || !scope || !selectedToken) return;
    setTaskSelection({ company: scope.company.uuid, token: selectedToken, task, locationKey: location.key });
  };
  const classSections = useRef(new Map<string, HTMLLIElement>());
  const focusedContext = useRef('');
  useEffect(() => {
    if (
      focusedContext.current === location.key ||
      held ||
      !sourceReady ||
      view === 'shareholders' ||
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
  }, [location.key, held, sourceReady, view, registerToken, registerRecord, registerCompany, scope]);

  return (
    <RegisterPage
      companyName={readable && sourceReady ? scope?.company.name : undefined}
      actions={
        scope &&
        view === 'register' && (
          <>
            {TASKS.map(([task, label]) => (
              <PageAction
                key={task}
                label={label}
                pressed={selectedTask === task}
                disabled={held || !sourceReady}
                onClick={() => chooseTask(task)}
              />
            ))}
            {canAddClass && (
              <PageLink
                primary
                to={`${DESTINATIONS.companyRegisterSetup.path}?company=${scope.company.uuid}`}
                label="Add share class"
              />
            )}
          </>
        )
      }
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
              />
            </div>
            <div hidden={view !== 'register' || selectedTask !== 'history'}>
              <RegisterParticulars
                landed={landed}
                owner={owner}
                guard={guard}
                company={scope.company.uuid}
                registers={scope.registers}
                visible={view === 'register' && selectedTask === 'history' && sourceReady}
                onHeldChange={companyHistoryHeld}
              />
              <RegisterLinks
                landed={landed}
                owner={owner}
                guard={guard}
                company={scope.company.uuid}
                registers={scope.registers}
                visible={view === 'register' && selectedTask === 'history' && sourceReady}
                onHeldChange={companyHistoryHeld}
              />
            </div>
            <div hidden={view !== 'documents'}>
              {readable && (
                <CompanyPack owner={owner} guard={guard} company={scope.company.uuid} sourceReady={sourceReady} />
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
      ) : preferenceRead.isFetching || classes.isPending ? (
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
      {scope && view === 'shareholders' && ownershipReady && (
        <>
          <CompanyShareholders
            key={scope.company.uuid}
            registers={scope.registers}
            company={scope.company.uuid}
            blocked={held}
          />
          <FormerShareholders registers={scope.registers} company={scope.company.uuid} blocked={held} />
        </>
      )}
      {scope && view === 'register' && (
        <>
          {ownershipReady && (
            <div className="grid items-start gap-4 sm:grid-cols-2">
              {scope.registers.map((register) => (
                <section
                  key={register.token.uuid}
                  className="min-w-0 space-y-4 rounded-xl border border-border bg-surface-raised p-4 sm:p-5"
                >
                  <h2 className="break-words text-base font-medium text-text-primary">
                    {register.token.name} · {register.token.symbol}
                  </h2>
                  <ClassRegister register={register} former={false} />
                  {held ? (
                    <PageAction
                      label="Class details"
                      context={register.token.name}
                      disabled
                      onClick={() => undefined}
                    />
                  ) : (
                    <PageLink
                      to={generatePath(DESTINATIONS.companyClass.path, { uuid: register.token.uuid })}
                      label="Class details"
                      context={register.token.name}
                    />
                  )}
                </section>
              ))}
            </div>
          )}
          <section aria-label="Register tasks" className="space-y-4">
            {selectedTask && sourceReady && scope.registers.length > 1 && (
              <div className="max-w-sm">
                <SelectField
                  label="Task share class"
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
                className="space-y-5 rounded-xl border border-border bg-surface-raised p-4 sm:p-5"
              >
                <h2 className="break-words font-display text-xl tracking-[-0.01em] text-text-primary">
                  {sourceReady ? `${register.token.name} · ${register.token.symbol}` : 'Register task recovery'}
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
                  <div hidden={view !== 'register' || selectedTask !== 'history'}>
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium">Recorded changes</h3>
                      {sourceReady && (
                        <LinkRow
                          to={generatePath(DESTINATIONS.companyClass.path, { uuid: register.token.uuid })}
                          label={DESTINATIONS.companyClass.title}
                        />
                      )}
                      {ON_CHAIN.includes(register.token.status) && (
                        <ClassOpenings
                          landed={landed}
                          owner={owner}
                          guard={guard}
                          register={register}
                          company={scope.company.uuid}
                          visible={
                            view === 'register' &&
                            selectedTask === 'history' &&
                            selectedToken === register.token.uuid &&
                            sourceReady
                          }
                          onHeldChange={historyHeld}
                        />
                      )}
                      <ClassImports
                        owner={owner}
                        guard={guard}
                        register={register}
                        company={scope.company.uuid}
                        visible={
                          view === 'register' &&
                          selectedTask === 'history' &&
                          selectedToken === register.token.uuid &&
                          sourceReady
                        }
                        onHeldChange={historyHeld}
                      />
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
                          selectedTask === 'history' &&
                          selectedToken === register.token.uuid &&
                          sourceReady
                        }
                        onHeldChange={historyHeld}
                      />
                      <ClassReconciliation
                        owner={owner}
                        guard={guard}
                        token={register.token.uuid}
                        company={scope.company.uuid}
                        holders={register.holders}
                        status={register.token.status}
                        visible={
                          view === 'register' &&
                          selectedTask === 'history' &&
                          selectedToken === register.token.uuid &&
                          sourceReady
                        }
                        onHeldChange={historyHeld}
                      />
                    </div>
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
                    />
                  </div>
                  <div hidden={view !== 'documents'} className="space-y-5">
                    {readable && (
                      <>
                        <RegisterDownload register={register} />
                        <ClassInspectionCopy
                          register={register}
                          guard={guard}
                          sourceReady={!classes.isFetching && !registers.isFetching}
                        />
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

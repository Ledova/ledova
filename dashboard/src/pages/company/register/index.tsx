import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_COPY,
  appointmentForRegisterStep,
  useSubmissionOwner,
  useUserPreferences,
  USER_PREFERENCES_QUERY_KEY,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LinkRow } from '@components/Ledger';
import { PageTitle } from '@components/PageTitle';
import { Page, PageAction } from '@components/Page';
import { FIELD_CLASS, LABEL } from '@components/fieldClass';
import { CompanySelection } from '@pages/company/shared/CompanySelection';
import { ownAppointmentsKey } from '@pages/company/shared/appointments';
import { ownershipSummary } from '@pages/company/shared/summary';
import { ClassCorrections } from './ClassCorrections';
import { ClassImports } from './ClassImports';
import { ClassGrants } from './ClassGrants';
import { ClassAllotments } from './ClassAllotments';
import { ClassAwards } from './ClassAwards';
import { ClassTransfers } from './ClassTransfers';
import { ClassOpenings } from './ClassOpenings';
import { ClassReconciliation } from './ClassReconciliation';
import { ClassRegister } from '@pages/company/register/shared/ClassRegister';
import { CompanyShareholders } from '@pages/company/register/shared/CompanyShareholders';
import { ClassInspectionCopy } from './ClassInspectionCopy';
import { CompanyMemberAccess } from './CompanyMemberAccess';
import { CompanyPack } from './CompanyPack';
import { RegisterLinks } from './RegisterLinks';
import { RegisterParticulars } from './RegisterParticulars';
import { Loading, Unavailable } from '@pages/company/shared/RegisterStatus';
import { registerKey } from '@hooks/useRegisterAccess';
import { registersQuery, useCompanyRegister, useRegisterDownload } from '@pages/company/shared/useCompanyRegister';
import { ownerGuard } from '@pages/company/register/shared/ownerGuard';
import { useOwnAppointments } from '@pages/company/register/shared/useOwnAppointments';

const ON_CHAIN = ['deployed', 'paused'];
const TASKS = [
  ['investor', 'Record investor share issue'],
  ['transfer', 'Transfer shares'],
  ['history', 'History'],
] as const;
type RegisterTask = (typeof TASKS)[number][0];

function RegisterPage({
  selection,
  companyName,
  sections,
  children,
}: {
  selection?: ReactNode;
  companyName?: string;
  sections?: ReactNode;
  children: ReactNode;
}) {
  const { hash } = useLocation();
  const title =
    hash === '#awards'
      ? 'Employee awards'
      : hash === '#documents'
        ? 'Documents'
        : hash === '#access'
          ? 'Member access'
          : 'Register';
  return (
    <PageTitle.Provider value={title}>
      <Page
        lede={
          hash === '#awards'
            ? 'Record employee entitlements and vesting. Shares are issued through a separate company decision.'
            : hash === '#documents'
              ? 'Prepare permitted register copies, certificates and company packs.'
              : hash === '#access'
                ? 'Invite named members and manage their access to company records.'
                : 'Company-recorded ownership and share issue decisions.'
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
        disabled={!register.initialized || download.isPending}
      />
      {download.isError && (
        <p role="alert" className="text-sm text-error-light">
          {REGISTER_COPY.DOWNLOAD_FAILED}
        </p>
      )}
    </div>
  );
}

function RegisterShareholders({
  owner,
  guard,
  registers,
  company,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  registers: TokenHoldersResponse[];
  company: string;
}) {
  const appointments = useOwnAppointments(owner, guard);
  const client = useQueryClient();
  const prepare =
    appointments.isSuccess &&
    !appointments.isFetching &&
    !!appointmentForRegisterStep(appointments.data, company, 'prepare');
  const guardPreparation = () => {
    guard();
    for (const key of [
      USER_PREFERENCES_QUERY_KEY,
      [...registerKey(owner), 'classes'],
      registersQuery(
        owner,
        registers.map(({ token }) => token.uuid),
      ).queryKey,
      ownAppointmentsKey(owner),
    ]) {
      const current = client.getQueryState(key);
      if (current?.status !== 'success' || current.fetchStatus !== 'idle')
        throw new Error('Refresh the register and your current preparation appointment.');
    }
    if (
      !appointmentForRegisterStep(
        client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [],
        company,
        'prepare',
      )
    )
      throw new Error('A current company preparation appointment is required.');
  };
  return <CompanyShareholders registers={registers} guardPreparation={prepare ? guardPreparation : undefined} />;
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
        <Loading />
      ) : (
        <Unavailable retry={() => void preferences.refetch()} busy={preferences.isFetching} />
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
  const { classes, companies, company, selectCompany, registers } = useCompanyRegister(owner, retained);
  const preferenceRead = useUserPreferences();
  const client = useQueryClient();
  const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const scope =
    held && retainedScope
      ? { company: retainedScope.company, registers: registers.data ?? retainedScope.registers }
      : company && registers.data
        ? { company, registers: registers.data }
        : null;
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
  const issueToken = typeof location.state?.awardIssueToken === 'string' ? location.state.awardIssueToken : '';
  const issueCompany = typeof location.state?.awardIssueCompany === 'string' ? location.state.awardIssueCompany : '';
  const registerCompany =
    typeof location.state?.registerCompany === 'string' ? location.state.registerCompany : issueCompany;
  const registerToken = typeof location.state?.registerToken === 'string' ? location.state.registerToken : '';
  const contextToken = registerToken || issueToken;
  const enteredIssue = useRef('');
  useEffect(() => {
    if (enteredIssue.current === location.key || !classes.isSuccess || classes.isFetching || held) return;
    if (
      registerCompany &&
      classes.data.some((item) => item.companyUuid === registerCompany && (!contextToken || item.uuid === contextToken))
    )
      selectCompany(registerCompany);
    enteredIssue.current = location.key;
  }, [
    enteredIssue,
    location.key,
    classes.isSuccess,
    classes.isFetching,
    classes.data,
    held,
    contextToken,
    registerCompany,
    selectCompany,
  ]);
  const view =
    hash === '#awards' ? 'awards' : hash === '#documents' ? 'documents' : hash === '#access' ? 'access' : 'register';
  const requestedToken =
    scope && scope.company.uuid === registerCompany && scope.registers.some(({ token }) => token.uuid === registerToken)
      ? registerToken
      : undefined;
  const localSelection =
    taskSelection?.company === scope?.company.uuid && taskSelection?.locationKey === location.key
      ? taskSelection
      : null;
  const pinned = [...heldClasses].find((key) =>
    ['allotments/', 'transfer/', 'history/'].some((prefix) => key.startsWith(prefix)),
  );
  const pinnedParts = pinned?.split('/');
  const selectedTask =
    pinnedParts?.[0] === 'allotments'
      ? 'investor'
      : pinnedParts?.[0] === 'transfer'
        ? 'transfer'
        : pinnedParts?.[0] === 'history'
          ? 'history'
          : (localSelection?.task ??
            (requestedToken ? (location.state?.registerHistory === true ? 'history' : 'investor') : undefined));
  const candidateToken =
    pinnedParts && pinnedParts[1] !== 'company' ? pinnedParts[1] : (localSelection?.token ?? requestedToken);
  const selectedToken = scope?.registers.some(({ token }) => token.uuid === candidateToken)
    ? candidateToken
    : scope?.registers[0]?.token.uuid;
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
      view === 'access' ||
      !registerToken ||
      scope?.company.uuid !== registerCompany ||
      !scope.registers.some(({ token }) => token.uuid === registerToken)
    )
      return;
    const section = classSections.current.get(registerToken);
    if (!section) return;
    if (location.state?.registerHistory === true && view === 'register') {
      const history = section.querySelector<HTMLDetailsElement>('details[data-register-history]');
      if (history) history.open = true;
    }
    section.focus({ preventScroll: true });
    section.scrollIntoView?.({ block: 'start' });
    focusedContext.current = location.key;
  }, [location.key, location.state, held, sourceReady, view, registerToken, registerCompany, scope]);

  return (
    <RegisterPage
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
            <div hidden={view !== 'access'}>
              <CompanyMemberAccess
                key={`members/${scope.company.uuid}`}
                owner={owner}
                guard={guard}
                company={scope.company.uuid}
                registers={scope.registers}
                sourceReady={sourceReady}
                onHeldChange={setMemberHeld}
              />
            </div>
            <div hidden={view !== 'register' || selectedTask !== 'history'}>
              <RegisterParticulars
                owner={owner}
                guard={guard}
                company={scope.company.uuid}
                registers={scope.registers}
                visible={view === 'register' && selectedTask === 'history' && sourceReady}
                onHeldChange={companyHistoryHeld}
              />
              <RegisterLinks
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
        <Unavailable retry={() => void preferenceRead.refetch()} busy={preferenceRead.isFetching} />
      ) : preferenceRead.isFetching || classes.isPending ? (
        <Loading />
      ) : classes.isError || registers.isError || (held && !sourceReady) ? (
        <Unavailable
          retry={() => {
            void classes.refetch();
            void registers.refetch();
          }}
          busy={classes.isFetching || registers.isFetching}
        />
      ) : companies.length === 0 ? (
        <p className="py-3 text-sm text-text-muted">{REGISTER_COPY.NO_REGISTER}</p>
      ) : !company ? (
        <p className="py-3 text-sm text-text-muted">Select a company to show its register.</p>
      ) : registers.isPending ? (
        <Loading />
      ) : null}
      {scope && view === 'register' && (
        <>
          {ownershipInvalid ? (
            <Unavailable
              retry={() => {
                void classes.refetch();
                void registers.refetch();
              }}
              busy={classes.isFetching || registers.isFetching}
            />
          ) : ownershipReady ? (
            <>
              <div aria-label="Share class summaries" className="grid items-start gap-4 sm:grid-cols-2">
                {scope.registers.map((register) => (
                  <section
                    key={register.token.uuid}
                    className="min-w-0 space-y-4 rounded-xl border border-border bg-surface-raised p-4 sm:p-5"
                  >
                    <p className="break-words text-base font-medium text-text-primary">
                      {register.token.name} · {register.token.symbol}
                    </p>
                    <ClassRegister register={register} />
                  </section>
                ))}
              </div>
              <RegisterShareholders
                key={scope.company.uuid}
                owner={owner}
                guard={guard}
                company={scope.company.uuid}
                registers={scope.registers}
              />
            </>
          ) : null}
          <section aria-label="Register tasks" className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {TASKS.map(([task, label]) => (
                <PageAction
                  key={task}
                  label={label}
                  active={selectedTask === task}
                  disabled={held || !sourceReady}
                  onClick={() => chooseTask(task)}
                />
              ))}
            </div>
            {selectedTask && sourceReady && scope.registers.length > 1 && (
              <label className={`${LABEL} max-w-sm`}>
                Task share class
                <select
                  className={FIELD_CLASS}
                  value={selectedToken}
                  disabled={held}
                  onChange={(event) => {
                    if (!held && sourceReady)
                      setTaskSelection({
                        company: scope.company.uuid,
                        token: event.target.value,
                        task: selectedTask,
                        locationKey: location.key,
                      });
                  }}
                >
                  {scope.registers.map(({ token }) => (
                    <option key={token.uuid} value={token.uuid}>
                      {token.name} · {token.symbol}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>
        </>
      )}
      {scope && (
        <ul hidden={view === 'access'} className="space-y-6">
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
                  <div hidden={view !== 'register' || selectedTask !== 'investor'}>
                    <ClassAllotments
                      key={`allotments/${scope.company.uuid}/${register.token.uuid}`}
                      owner={owner}
                      guard={guard}
                      register={register}
                      company={scope.company.uuid}
                      sourceReady={sourceReady}
                      visible={
                        view === 'register' && selectedTask === 'investor' && selectedToken === register.token.uuid
                      }
                      onHeldChange={allotmentHeld}
                    />
                  </div>
                  <div hidden={view !== 'register' || selectedTask !== 'transfer'}>
                    <ClassTransfers
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
                    <details
                      data-register-history
                      open={view === 'register' && selectedTask === 'history'}
                      className="space-y-4"
                    >
                      <summary className="cursor-pointer text-sm font-medium">Recorded changes</summary>
                      {sourceReady && (
                        <LinkRow
                          to={DESTINATIONS.companyClass.path.replace(':uuid', register.token.uuid)}
                          label={DESTINATIONS.companyClass.title}
                        />
                      )}
                      {ON_CHAIN.includes(register.token.status) && (
                        <ClassOpenings
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
                    </details>
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
                    <details
                      open={issueToken === register.token.uuid}
                      className="space-y-3 border-t border-border-subtle pt-4"
                    >
                      <summary className="cursor-pointer text-sm font-medium">Non-paid share issues</summary>
                      <ClassGrants
                        owner={owner}
                        guard={guard}
                        register={register}
                        company={scope.company.uuid}
                        sourceReady={sourceReady}
                        onHeldChange={grantHeld}
                      />
                    </details>
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

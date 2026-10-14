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
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LinkRow, Section } from '@components/Ledger';
import { PageTitle } from '@components/PageTitle';
import { Page, PageAction } from '@components/Page';
import { CompanySelection } from '../CompanySelection';
import { ClassCorrections } from './ClassCorrections';
import { ClassImports } from './ClassImports';
import { ClassGrants } from './ClassGrants';
import { ClassAllotments } from './ClassAllotments';
import { ClassAwards } from './ClassAwards';
import { ClassTransfers } from './ClassTransfers';
import { ClassOpenings } from './ClassOpenings';
import { ClassReconciliation } from './ClassReconciliation';
import { ClassRegister } from './ClassRegister';
import { ClassInspectionCopy } from './ClassInspectionCopy';
import { CompanyMemberAccess } from './CompanyMemberAccess';
import { CompanyPack } from './CompanyPack';
import { RegisterLinks } from './RegisterLinks';
import { RegisterParticulars } from './RegisterParticulars';
import { Loading, Unavailable } from './RegisterStatus';
import { useCompanyRegister, useRegisterDownload } from './useCompanyRegister';
import { ownerGuard, useOwnAppointments } from './useRegisterImports';

const ON_CHAIN = ['deployed', 'paused'];

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
        narrow
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

function RegisterMembers({
  owner,
  guard,
  register,
  company,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  register: TokenHoldersResponse;
  company: string;
}) {
  const appointments = useOwnAppointments(owner, guard);
  const prepare = appointments.isSuccess && !!appointmentForRegisterStep(appointments.data, company, 'prepare');
  return <ClassRegister register={register} prepare={prepare} />;
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
  const sourceReady = readable && preferences?.fetchStatus === 'idle' && !classes.isFetching && !registers.isFetching;
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
            <div hidden={view !== 'register'}>
              <LinkRow to="#access" label="Member access" />
              {readable && (
                <details className="space-y-3 border-t border-border pt-4">
                  <summary className="cursor-pointer text-base font-medium">Particulars and wallet links</summary>
                  <RegisterParticulars
                    owner={owner}
                    guard={guard}
                    company={scope.company.uuid}
                    registers={scope.registers}
                  />
                  <RegisterLinks owner={owner} guard={guard} company={scope.company.uuid} registers={scope.registers} />
                </details>
              )}
              <details className="space-y-3 border-t border-border pt-4">
                <summary className="cursor-pointer text-base font-medium">Register guidance</summary>
                <p className="text-sm text-text-muted">
                  Company appointees prepare, approve and record supported changes. This view shows the company’s
                  recorded ownership; wallet balances do not replace it. Share class settings retain empty-class
                  deployment and supported tokenised workflows. Importing holdings does not tokenise them. Outputs are
                  company-provided, and certificates are unsigned. Publications retain their existing staff workflow.
                </p>
              </details>
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
              <Section title={readable ? `${register.token.name} · ${register.token.symbol}` : 'Share issue recovery'}>
                <div hidden={view !== 'register'} className="space-y-5">
                  {readable && (
                    <RegisterMembers owner={owner} guard={guard} register={register} company={scope.company.uuid} />
                  )}
                  <ClassAllotments
                    key={`allotments/${scope.company.uuid}/${register.token.uuid}`}
                    owner={owner}
                    guard={guard}
                    register={register}
                    company={scope.company.uuid}
                    sourceReady={sourceReady}
                    onHeldChange={allotmentHeld}
                  />
                  {readable && (
                    <details data-register-history className="space-y-3 border-t border-border-subtle pt-4">
                      <summary className="cursor-pointer text-sm font-medium">
                        Other changes and register history
                      </summary>
                      <LinkRow
                        to={DESTINATIONS.companyClass.path.replace(':uuid', register.token.uuid)}
                        label={DESTINATIONS.companyClass.title}
                      />
                      {ON_CHAIN.includes(register.token.status) && (
                        <ClassOpenings owner={owner} guard={guard} register={register} company={scope.company.uuid} />
                      )}
                      <ClassImports owner={owner} guard={guard} register={register} company={scope.company.uuid} />
                      <ClassTransfers owner={owner} guard={guard} register={register} company={scope.company.uuid} />
                      <ClassCorrections
                        owner={owner}
                        guard={guard}
                        token={register.token.uuid}
                        company={scope.company.uuid}
                        register={register}
                        sourceReady={sourceReady}
                      />
                      <ClassReconciliation
                        owner={owner}
                        guard={guard}
                        token={register.token.uuid}
                        company={scope.company.uuid}
                        holders={register.holders}
                      />
                    </details>
                  )}
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
              </Section>
            </li>
          ))}
        </ul>
      )}
    </RegisterPage>
  );
}

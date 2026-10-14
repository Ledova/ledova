import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_COPY,
  appointmentForRegisterStep,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { CompanySelection } from '../CompanySelection';
import { Loading, Unavailable } from '../register/RegisterStatus';
import { useCompanyRegister } from '../register/useCompanyRegister';
import { ownerGuard, useOwnAppointments } from '../register/useRegisterImports';
import { ClassCountPanel, OwnershipMetrics, ShareholderPanel } from './OwnershipPanels';
import { RecentChanges } from './RecentChanges';
import { RegisterSetup } from './RegisterSetup';
import { ownershipSummary } from './summary';

export default function CompanyDashboardPage() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  return (
    <PageTitle.Provider value="Dashboard">
      {owner ? (
        <OwnDashboard key={`${owner.userUuid}/${owner.ownerAccountUuid}`} owner={owner} currentOwner={boundary.get} />
      ) : (
        <Page lede="Your company's recorded share ownership.">
          {preferences.isLoading ? (
            <Loading />
          ) : (
            <Unavailable retry={() => void preferences.refetch()} busy={preferences.isFetching} />
          )}
        </Page>
      )}
    </PageTitle.Provider>
  );
}

function OwnDashboard({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const preferences = useUserPreferences();
  const { classes, companies, company, selectCompany, registers } = useCompanyRegister(owner);
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const appointments = useOwnAppointments(owner, guard);
  const location = useLocation();
  const entered = useRef('');
  useEffect(() => {
    if (entered.current === location.key || !classes.isSuccess || classes.isFetching) return;
    const wanted = location.state?.registerCompany;
    if (typeof wanted === 'string' && classes.data.some((token) => token.companyUuid === wanted)) selectCompany(wanted);
    entered.current = location.key;
  }, [classes.isSuccess, classes.isFetching, classes.data, location.key, location.state, selectCompany]);
  const [selection, setSelection] = useState<{ company: string; token: string } | null>(null);
  const rows = registers.data ?? [];
  const expected = classes.data?.filter((item) => item.companyUuid === company?.uuid) ?? [];
  const scoped =
    !!company &&
    rows.length > 0 &&
    rows.length === expected.length &&
    rows.every(({ token }) => expected.some((item) => item.uuid === token.uuid));
  let summary: ReturnType<typeof ownershipSummary> | null = null;
  let invalid = !!company && registers.isSuccess && !scoped;
  if (scoped) {
    try {
      summary = ownershipSummary(rows);
    } catch {
      invalid = true;
    }
  }
  const preferencesReady = !!preferences.preferences && !preferences.isError && !preferences.isFetching;
  const fresh =
    preferencesReady && classes.isSuccess && !classes.isFetching && registers.isSuccess && !registers.isFetching;
  const selected =
    rows.find(({ token }) => selection?.company === company?.uuid && token.uuid === selection?.token) ?? rows[0];
  const prepare =
    fresh &&
    company &&
    appointments.isSuccess &&
    !appointments.isFetching &&
    appointmentForRegisterStep(appointments.data, company.uuid, 'prepare');
  const refresh = () => {
    void preferences.refetch();
    void classes.refetch();
    if (company) void registers.refetch();
    void appointments.refetch();
  };
  return (
    <Page
      lede={company ? `${company.name} · Recorded share ownership` : "Your company's recorded share ownership."}
      actions={
        <PageAction
          label="Refresh dashboard"
          onClick={refresh}
          disabled={preferences.isFetching || classes.isFetching || registers.isFetching}
        />
      }
    >
      {preferencesReady && classes.isSuccess && !classes.isFetching && companies.length > 1 && (
        <CompanySelection read={{ companies, companyUuid: company?.uuid, selectionBlocked: false, selectCompany }} />
      )}
      {preferences.isError || classes.isError || registers.isError || invalid ? (
        <Unavailable retry={refresh} busy={preferences.isFetching || classes.isFetching || registers.isFetching} />
      ) : preferences.isFetching || classes.isPending || (company && registers.isPending) || (company && !fresh) ? (
        <Loading />
      ) : companies.length === 0 ? (
        <RegisterSetup />
      ) : !company ? (
        <p className="py-3 text-sm text-text-muted">Select a company to show its ownership.</p>
      ) : fresh && scoped && summary && selected ? (
        <>
          <OwnershipMetrics summary={summary} />
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-6">
              <ShareholderPanel
                company={company.uuid}
                registers={rows}
                selected={selected}
                select={(token) => setSelection({ company: company.uuid, token })}
              />
              {selected.initialized && (
                <RecentChanges
                  key={`${company.uuid}/${selected.token.uuid}`}
                  owner={owner}
                  guard={guard}
                  company={company.uuid}
                  token={selected.token.uuid}
                  className={selected.token.name}
                />
              )}
            </div>
            <div className="min-w-0 space-y-6">
              <RegisterWork company={company.uuid} register={selected} prepare={!!prepare} />
              <ClassCountPanel registers={rows} />
            </div>
          </div>
        </>
      ) : null}
    </Page>
  );
}

function RegisterWork({
  company,
  register,
  prepare,
}: {
  company: string;
  register: TokenHoldersResponse;
  prepare: boolean;
}) {
  const state = { registerCompany: company, registerToken: register.token.uuid };
  return (
    <Section title="Register work">
      {!register.initialized && (
        <p className="text-sm text-text-muted">
          Bring in this class’s existing ownership records before recording changes.
        </p>
      )}
      {register.initialized && register.waitingEffects === null && (
        <p role="status" className="text-sm text-text-muted">
          {REGISTER_COPY.WAITING_UNKNOWN_NOTE}
        </p>
      )}
      {register.waitingEffects !== null && register.waitingEffects > 0 && (
        <p role="status" className="text-sm text-text-muted">
          {REGISTER_COPY.WAITING_NOTE(register.waitingEffects)}
        </p>
      )}
      <div className="flex flex-col items-start gap-3 py-2 text-sm font-medium text-brand-mid">
        {prepare && !register.initialized && (
          <Link
            to={DESTINATIONS.companyRegisterImport.path.replace(':uuid', register.token.uuid)}
            className="hover:underline"
          >
            Set up your share register
          </Link>
        )}
        {prepare && register.initialized && (
          <Link to={DESTINATIONS.companyRegister.path} state={state} className="hover:underline">
            Issue investor shares
          </Link>
        )}
        {prepare && register.initialized && (
          <Link to={`${DESTINATIONS.companyRegister.path}#awards`} state={state} className="hover:underline">
            Record an employee award
          </Link>
        )}
        <Link to={DESTINATIONS.companyRegister.path} state={state} className="hover:underline">
          Manage register
        </Link>
        <Link to={`${DESTINATIONS.companyRegister.path}#documents`} state={state} className="hover:underline">
          Certificates and exports
        </Link>
      </div>
    </Section>
  );
}

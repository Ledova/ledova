import { useEffect, useMemo, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  DESTINATIONS,
  appointmentForRegisterStep,
  companiesAwaitingActivation,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Page } from '@components/Page';
import { CompanySelection } from '@pages/company/shared/CompanySelection';
import { Loading } from '@pages/company/shared/RegisterStatus';
import { useCompanyRegister } from '@pages/company/shared/useCompanyRegister';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { GettingStarted } from './GettingStarted';
import { OwnershipMetrics, ShareholderPanels } from './OwnershipPanels';
import { ownershipSummary } from '@pages/company/shared/summary';
import { LoadError } from '@components/Ledger';

export default function CompanyDashboardPage() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  return owner ? (
    <OwnDashboard key={`${owner.userUuid}/${owner.ownerAccountUuid}`} owner={owner} currentOwner={boundary.get} />
  ) : (
    <Page lede="Your company's recorded share ownership.">
      {preferences.isLoading ? (
        <Loading />
      ) : (
        <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
          Your account could not be loaded.
        </LoadError>
      )}
    </Page>
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
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const { classes, companies, company, selectCompany, registers } = useCompanyRegister(owner, guard);
  const appointments = useOwnAppointments(owner, guard);
  const location = useLocation();
  const entered = useRef('');
  useEffect(() => {
    if (entered.current === location.key || !classes.isSuccess || classes.isFetching) return;
    const wanted = location.state?.registerCompany;
    if (typeof wanted === 'string' && classes.data.some((token) => token.companyUuid === wanted)) selectCompany(wanted);
    entered.current = location.key;
  }, [classes.isSuccess, classes.isFetching, classes.data, location.key, location.state, selectCompany]);
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
  const own = appointments.data ?? [];
  const administered = own.filter(
    (appointment) => appointment.isEffective && appointment.capabilities.includes('admin'),
  );
  const shown =
    company ??
    (companies.length === 0 && new Set(administered.map((appointment) => appointment.company)).size === 1
      ? { uuid: administered[0]!.company, name: administered[0]!.companyName }
      : undefined);
  const status = own.find((appointment) => appointment.company === shown?.uuid)?.companyStatusDisplay;
  const activated = companiesAwaitingActivation(own).length === 0;
  const opened = (uuid: string) =>
    company?.uuid === uuid
      ? scoped && rows.some(({ initialized }) => initialized)
      : companies.some((item) => item.uuid === uuid);
  const registered = administered.every((appointment) => opened(appointment.company));
  const preparing = own.some(
    (appointment) =>
      !appointment.revokedAt && appointmentForRegisterStep([appointment], appointment.company, 'prepare'),
  );
  const gettingStarted =
    appointments.isSuccess &&
    classes.isSuccess &&
    (!company || (registers.isSuccess && !invalid)) &&
    administered.length > 0 &&
    (!activated || !registered);
  const refresh = () => {
    void preferences.refetch();
    void classes.refetch();
    void appointments.refetch();
    if (company) void registers.refetch();
  };
  return (
    <Page lede={shown ? [shown.name, status].filter(Boolean).join(' · ') : "Your company's recorded share ownership."}>
      {gettingStarted && <GettingStarted activated={activated} registered={registered} />}
      {preferencesReady && classes.isSuccess && !classes.isFetching && companies.length > 1 && (
        <CompanySelection read={{ companies, companyUuid: company?.uuid, selectionBlocked: false, selectCompany }} />
      )}
      {preferences.isError || classes.isError || registers.isError || appointments.isError || invalid ? (
        <LoadError
          retry={refresh}
          busy={preferences.isFetching || classes.isFetching || registers.isFetching || appointments.isFetching}
        >
          The register could not be loaded.
        </LoadError>
      ) : preferences.isFetching ||
        classes.isPending ||
        appointments.isPending ||
        (company && registers.isPending) ||
        (company && !fresh) ? (
        <Loading />
      ) : companies.length === 0 ? (
        !gettingStarted && (
          <p className="py-3 text-sm text-text-muted">
            No share register yet.
            {preparing && (
              <>
                {' '}
                <Link to={DESTINATIONS.companyRegister.path} className="text-brand-light underline">
                  Open Register
                </Link>{' '}
                to set it up.
              </>
            )}
          </p>
        )
      ) : !company ? (
        <p className="py-3 text-sm text-text-muted">Select a company to show its ownership.</p>
      ) : fresh && scoped && summary ? (
        <>
          <OwnershipMetrics summary={summary} />
          <ShareholderPanels registers={rows} />
        </>
      ) : null}
    </Page>
  );
}

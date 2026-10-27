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
import { CompanySelection } from '@components/CompanySelection';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { GettingStarted } from './GettingStarted';
import { OwnershipMetrics } from '@components/ownership/OwnershipMetrics';
import { OwnershipExplorer } from './OwnershipExplorer';
import { OwnershipLoading } from './OwnershipLoading';
import { useOwnership } from './useOwnership';
import { LoadError, Loading } from '@components/Ledger';

export default function CompanyDashboardPage() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  return owner ? (
    <OwnDashboard key={`${owner.userUuid}/${owner.ownerAccountUuid}`} owner={owner} currentOwner={boundary.get} />
  ) : (
    <Page lede="Your company's recorded share ownership.">
      {preferences.isLoading ? (
        <Loading>Loading your account…</Loading>
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
  const {
    classes,
    companies,
    company,
    selectCompany,
    adoptCompany,
    overview,
    holders,
    selected,
    select,
    list,
    scopeError,
    recover,
  } = useOwnership(owner, guard);
  const appointments = useOwnAppointments(owner, guard);
  const location = useLocation();
  const entered = useRef('');
  useEffect(() => {
    const wanted = location.state?.registerCompany;
    if (typeof wanted !== 'string' || entered.current === wanted || !classes.isSuccess || classes.isFetching) return;
    if (classes.data.some((token) => token.companyUuid === wanted)) adoptCompany(wanted);
    entered.current = wanted;
  }, [classes.isSuccess, classes.isFetching, classes.data, location.state, adoptCompany]);
  const summary = overview.data;
  const scoped = !!company && summary?.company === company.uuid;
  const preferencesReady = !!preferences.preferences && !preferences.isError && !preferences.isFetching;
  const fresh =
    preferencesReady && classes.isSuccess && !classes.isFetching && overview.isSuccess && !overview.isFetching;
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
      ? scoped && summary.classes.some(({ initialized }) => initialized)
      : companies.some((item) => item.uuid === uuid);
  const registered = administered.every((appointment) => opened(appointment.company));
  const preparing = own.some(
    (appointment) =>
      !appointment.revokedAt && appointmentForRegisterStep([appointment], appointment.company, 'prepare'),
  );
  const gettingStarted =
    appointments.isSuccess &&
    classes.isSuccess &&
    (!company || overview.isSuccess) &&
    administered.length > 0 &&
    (!activated || !registered);
  const refresh = () => {
    void preferences.refetch();
    void appointments.refetch();
    void recover();
  };
  return (
    <Page lede={shown ? [shown.name, status].filter(Boolean).join(' · ') : "Your company's recorded share ownership."}>
      {gettingStarted && <GettingStarted activated={activated} registered={registered} />}
      {preferencesReady && classes.isSuccess && !classes.isFetching && companies.length > 1 && (
        <CompanySelection read={{ companies, companyUuid: company?.uuid, selectionBlocked: false, selectCompany }} />
      )}
      {preferences.isError || classes.isError || overview.isError || appointments.isError || scopeError ? (
        <LoadError
          retry={refresh}
          busy={preferences.isFetching || classes.isFetching || overview.isFetching || appointments.isFetching}
        >
          {preferences.isError
            ? 'Your account could not be loaded.'
            : appointments.isError && !classes.isError && !overview.isError
              ? 'Your appointments could not be loaded.'
              : 'The register could not be loaded.'}
        </LoadError>
      ) : preferences.isFetching ||
        classes.isPending ||
        appointments.isPending ||
        (company && overview.isPending) ||
        (company && !fresh) ? (
        <OwnershipLoading />
      ) : companies.length === 0 ? (
        !gettingStarted && (
          <p className="py-3 text-sm text-text-muted">
            No share register yet.
            {preparing && (
              <>
                {' '}
                <Link to={DESTINATIONS.companyRegister.path} className="text-brand-light underline">
                  Open Ledger
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
          <OwnershipExplorer
            key={company.uuid}
            classes={summary.classes}
            complete={summary.complete}
            issuedSupply={summary.issuedSupply}
            selected={selected?.uuid ?? null}
            onSelect={select}
            holders={holders.isSuccess && !holders.isFetching ? holders.data : undefined}
            loading={!!selected?.initialized && (holders.isPending || holders.isFetching)}
            error={holders.error}
            retry={() => void holders.refetch()}
            list={list}
          />
        </>
      ) : null}
    </Page>
  );
}

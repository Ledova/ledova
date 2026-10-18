import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useSubmissionOwner, useUserPreferences, type OrderSubmissionOwner } from '@ledova/shared';
import { Page } from '@components/Page';
import { CompanySelection } from '@pages/company/shared/CompanySelection';
import { Loading, Unavailable } from '@pages/company/shared/RegisterStatus';
import { useCompanyRegister } from '@pages/company/shared/useCompanyRegister';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { OwnershipMetrics, ShareholderPanels } from './OwnershipPanels';
import { RegisterSetup } from './RegisterSetup';
import { ownershipSummary } from '@pages/company/shared/summary';

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
        <Unavailable retry={() => void preferences.refetch()} busy={preferences.isFetching} />
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
  const refresh = () => {
    void preferences.refetch();
    void classes.refetch();
    if (company) void registers.refetch();
  };
  return (
    <Page lede={company ? `${company.name} · Recorded share ownership` : "Your company's recorded share ownership."}>
      {preferencesReady && classes.isSuccess && !classes.isFetching && companies.length > 1 && (
        <CompanySelection read={{ companies, companyUuid: company?.uuid, selectionBlocked: false, selectCompany }} />
      )}
      {preferences.isError || classes.isError || registers.isError || invalid ? (
        <Unavailable retry={refresh} busy={preferences.isFetching || classes.isFetching || registers.isFetching} />
      ) : preferences.isFetching || classes.isPending || (company && registers.isPending) || (company && !fresh) ? (
        <Loading />
      ) : companies.length === 0 ? (
        <RegisterSetup owner={owner} currentOwner={currentOwner} />
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

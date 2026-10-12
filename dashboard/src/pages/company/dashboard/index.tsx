import { Link } from 'react-router-dom';
import { DESTINATIONS, useSubmissionOwner, useUserPreferences } from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { Section } from '@components/Ledger';
import { useRegisterClasses } from '../register/useCompanyRegister';

function CompanyOverview({ owner }: { owner: NonNullable<ReturnType<typeof useSubmissionOwner>['owner']> }) {
  const classes = useRegisterClasses(owner);
  const companies = [...new Map((classes.data ?? []).map((item) => [item.companyUuid, item.companyName])).entries()];
  if (classes.isError)
    return (
      <div role="alert" className="space-y-3">
        <p>Your company registers could not be loaded.</p>
        <PageAction label="Try again" onClick={() => void classes.refetch()} disabled={classes.isFetching} />
      </div>
    );
  if (classes.isPending || classes.isFetching) return <p role="status">Loading your company registers…</p>;
  return companies.length === 0 ? (
    <Section title="Company setup">
      <p className="text-sm text-text-muted">No readable share register is available for this account.</p>
      <Link className="text-sm text-brand-mid underline" to={DESTINATIONS.settings.path}>
        Open Settings
      </Link>
    </Section>
  ) : (
    <div className="grid gap-6 xl:grid-cols-2">
      {companies.map(([uuid, name]) => (
        <Section key={uuid} title={name}>
          <p className="text-sm text-text-muted">Company-recorded ownership and share issues.</p>
          <div className="flex flex-wrap gap-4 py-3">
            {[
              ['Register', ''],
              ['Employee awards', '#awards'],
              ['Documents', '#documents'],
            ].map(([label, hash]) => (
              <Link
                key={label}
                to={`${DESTINATIONS.companyRegister.path}${hash}`}
                state={{ registerCompany: uuid }}
                className="text-sm text-brand-mid underline"
              >
                {label}
              </Link>
            ))}
          </div>
        </Section>
      ))}
    </div>
  );
}

export default function CompanyDashboardPage() {
  const { owner } = useSubmissionOwner();
  const preferences = useUserPreferences();
  return (
    <Page lede="Company-recorded ownership and the next register task.">
      {preferences.isError ? (
        <div role="alert" className="space-y-3">
          <p>Your account could not be checked.</p>
          <PageAction label="Try again" onClick={() => void preferences.refetch()} disabled={preferences.isFetching} />
        </div>
      ) : owner && preferences.preferences && !preferences.isFetching ? (
        <CompanyOverview key={`${owner.userUuid}/${owner.ownerAccountUuid}`} owner={owner} />
      ) : (
        <p role="status">Checking your account…</p>
      )}
    </Page>
  );
}

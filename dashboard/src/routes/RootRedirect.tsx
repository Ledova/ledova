import { Navigate } from 'react-router-dom';
import { DESTINATIONS, useAuth, useUserPreferences } from '@ledova/shared';
import { useRegisterEntryAccess } from '@pages/company/register/useCompanyRegister';
import { Page, PageAction } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { COMPANY_DASHBOARD_PATH } from './companyDashboard';

export function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth();
  const preferences = useUserPreferences();
  const access = useRegisterEntryAccess();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/signin" replace />;
  if (
    preferences.isError ||
    access.isError ||
    (!preferences.isLoading && !preferences.isFetching && !preferences.userAccount)
  )
    return (
      <PageTitle.Provider value="Dashboard">
        <Page>
          <p role="alert" className="text-sm text-text-muted">
            Your dashboard access could not be checked.
          </p>
          <PageAction
            label="Try again"
            onClick={() => {
              void preferences.refetch();
              void access.refetch();
            }}
            disabled={preferences.isFetching || access.isFetching}
          />
        </Page>
      </PageTitle.Provider>
    );
  if (preferences.isLoading || preferences.isFetching || access.isPending || access.isFetching)
    return (
      <p role="status" className="p-6 text-sm text-text-muted">
        Checking your dashboard access…
      </p>
    );
  return <Navigate to={access.data ? COMPANY_DASHBOARD_PATH : DESTINATIONS.home.path} replace />;
}

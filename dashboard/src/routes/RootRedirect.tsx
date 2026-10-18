import { Navigate } from 'react-router-dom';
import { DESTINATIONS, canOpen, useAuth, useUserPreferences } from '@ledova/shared';
import { useRegisterEntryAccess } from '@hooks/useRegisterAccess';
import { Page, PageAction } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { COMPANY_DASHBOARD_PATH, SIGNIN_PATH, SIGNUP_PATHS } from '@utils/paths';
import { useUserProfile } from '@hooks/useUserProfile';
import { AccountUnavailable } from './AccountUnavailable';
import { SIGNUP_RESUMES_AT } from '@utils/paths';

export function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth();
  const preferences = useUserPreferences();
  const profile = useUserProfile();
  const access = useRegisterEntryAccess(!!profile.userProfile?.isSignupCompleted && !profile.isFetching);
  if (isLoading || (isAuthenticated && profile.isLoading)) return null;
  if (!isAuthenticated) return <Navigate to={SIGNIN_PATH} replace />;
  if (!profile.userProfile) return <AccountUnavailable onRetry={profile.refreshProfile} />;
  if (!profile.userProfile.isSignupCompleted)
    return (
      <Navigate
        to={
          canOpen(preferences.userAccount?.role ?? 'investor', 'company') &&
          (profile.userProfile.fullName?.trim().split(/\s+/).length ?? 0) > 1
            ? SIGNUP_PATHS.companyRegistration
            : SIGNUP_RESUMES_AT
        }
        replace
      />
    );
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

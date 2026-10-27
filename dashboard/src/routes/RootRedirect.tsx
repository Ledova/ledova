import { Navigate } from 'react-router-dom';
import { DESTINATIONS, canOpen, useAuth, useUserPreferences } from '@ledova/shared';
import { Page } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { SIGNIN_PATH, SIGNUP_PATHS } from '@utils/paths';
import { useUserProfile } from '@hooks/useUserProfile';
import { AccountUnavailable } from './AccountUnavailable';
import { SIGNUP_RESUMES_AT } from '@utils/paths';
import { LoadError, Loading } from '@components/Ledger';
import { pendingMemberInvitation } from '@utils/memberInvitation';
import { MEMBER_INVITATION_PATH } from '@utils/paths';

export function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth();
  const preferences = useUserPreferences();
  const profile = useUserProfile();
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
  if (pendingMemberInvitation()) return <Navigate to={MEMBER_INVITATION_PATH} replace />;
  if (preferences.isError || (!preferences.isLoading && !preferences.isFetching && !preferences.userAccount))
    return (
      <PageTitle.Provider value="Dashboard">
        <Page>
          <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
            Your dashboard access could not be checked.
          </LoadError>
        </Page>
      </PageTitle.Provider>
    );
  if (preferences.isLoading || preferences.isFetching)
    return (
      <div className="p-6">
        <Loading>Checking your dashboard access…</Loading>
      </div>
    );
  return <Navigate to={DESTINATIONS.home.path} replace />;
}

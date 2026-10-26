import { Navigate } from 'react-router-dom';
import { DESTINATIONS, canOpen, useAuth, useUserPreferences } from '@ledova/shared';
import { useRegisterEntryAccess } from '@hooks/useRegisterAccess';
import { Page } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { COMPANY_DASHBOARD_PATH, SIGNIN_PATH, SIGNUP_PATHS } from '@utils/paths';
import { useUserProfile } from '@hooks/useUserProfile';
import { AccountUnavailable } from './AccountUnavailable';
import { SIGNUP_RESUMES_AT } from '@utils/paths';
import { LoadError, Loading } from '@components/Ledger';
import { pendingMemberInvitation } from '@utils/memberInvitation';
import { MEMBER_INVITATION_PATH } from '@utils/paths';
import { useWorkspace } from '@hooks/useWorkspace';

export function RootRedirect() {
  const { isAuthenticated, isLoading } = useAuth();
  const preferences = useUserPreferences();
  const workspace = useWorkspace();
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
  if (pendingMemberInvitation()) return <Navigate to={MEMBER_INVITATION_PATH} replace />;
  if (workspace?.preferred === 'my-shares' && !preferences.isError && preferences.userAccount)
    return <Navigate to={DESTINATIONS.home.path} replace />;
  if (
    preferences.isError ||
    access.isError ||
    workspace?.unavailable ||
    (!preferences.isLoading && !preferences.isFetching && !preferences.userAccount)
  )
    return (
      <PageTitle.Provider value="Dashboard">
        <Page>
          <LoadError
            retry={() => Promise.all([preferences.refetch(), access.refetch(), workspace?.retry()])}
            busy={preferences.isFetching || access.isFetching}
          >
            Your dashboard access could not be checked.
          </LoadError>
        </Page>
      </PageTitle.Provider>
    );
  if (preferences.isLoading || preferences.isFetching || access.isPending || access.isFetching || workspace?.pending)
    return (
      <div className="p-6">
        <Loading>Checking your dashboard access…</Loading>
      </div>
    );
  const company = workspace ? workspace.mode === 'company' && workspace.canCompany : access.data;
  return <Navigate to={company ? COMPANY_DASHBOARD_PATH : DESTINATIONS.home.path} replace />;
}

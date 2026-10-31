import { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { RootRedirect } from './RootRedirect';
import { PAGES } from './pages';
import { signedInPage, signedInRoutes } from './signedInRoutes';
import { signupRoutes } from './signupRoutes';
import {
  COMPANY_DASHBOARD_PATH,
  ROOT_PATH,
  SIGNIN_PATH,
  SIGNUP_PATHS,
  NOT_FOUND_PATH,
  MEMBER_INVITATION_PATH,
} from '@utils/paths';
import { PublicOnlyRoute } from './PublicOnlyRoute';
import { RouteLoading } from './RouteLoading';
import {
  DashboardPage,
  MemberInvitationPage,
  NotFoundPage,
  SignInPage,
  SignupAccountType,
  SignupCompanyRegistration,
  SignupEmailConfirmation,
  SignupFinancialProfile,
  SignupPreScreening,
  SignupReview,
  SignupUser,
  SignupUserProfile,
} from './lazyPages';

const SIGNED_IN_ROUTES = signedInRoutes(PAGES);

const SIGNUP_ROUTES = signupRoutes(<SignupUser />, {
  [SIGNUP_PATHS.emailConfirmation]: <SignupEmailConfirmation />,
  [SIGNUP_PATHS.accountType]: <SignupAccountType />,
  [SIGNUP_PATHS.preScreening]: <SignupPreScreening />,
  [SIGNUP_PATHS.userProfile]: <SignupUserProfile />,
  [SIGNUP_PATHS.financialProfile]: <SignupFinancialProfile />,
  [SIGNUP_PATHS.companyRegistration]: <SignupCompanyRegistration />,
  [SIGNUP_PATHS.review]: <SignupReview />,
});

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path={ROOT_PATH} element={<RootRedirect />} />
        <Route path={MEMBER_INVITATION_PATH} element={<MemberInvitationPage />} />

        <Route
          path={SIGNIN_PATH}
          element={
            <PublicOnlyRoute>
              <SignInPage />
            </PublicOnlyRoute>
          }
        />

        {SIGNUP_ROUTES}

        {SIGNED_IN_ROUTES}
        <Route path={COMPANY_DASHBOARD_PATH} element={signedInPage(<DashboardPage />, 'Dashboard', 'everyone')} />

        <Route path={NOT_FOUND_PATH} element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

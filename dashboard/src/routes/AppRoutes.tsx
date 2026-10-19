import { Routes, Route } from 'react-router-dom';
import NotFoundPage from '@pages/not-found';
import { RootRedirect } from './RootRedirect';
import { PAGES } from './pages';
import { signedInRoutes } from './signedInRoutes';
import { signupRoutes } from './signupRoutes';
import SignInPage from '@pages/signin';
import SignupUser from '@pages/signup';
import SignupEmailConfirmation from '@pages/signup/email-confirmation';
import SignupPreScreening from '@pages/signup/pre-screening';
import SignupUserProfile from '@pages/signup/user-profile';
import SignupFinancialProfile from '@pages/signup/financial-profile';
import SignupReview from '@pages/signup/review';

import SignupAccountType from '@pages/signup/account-type';
import SignupCompanyRegistration from '@pages/signup/company-registration';
import CompanyDashboardPage from '@pages/company/dashboard';
import { PageTitle } from '@components/PageTitle';
import { ProtectedRoute } from './ProtectedRoute';
import { COMPANY_DASHBOARD_PATH, ROOT_PATH, SIGNIN_PATH, SIGNUP_PATHS, NOT_FOUND_PATH } from '@utils/paths';
import { PublicOnlyRoute } from './PublicOnlyRoute';

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
    <Routes>
      <Route path={ROOT_PATH} element={<RootRedirect />} />

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
      <Route
        path={COMPANY_DASHBOARD_PATH}
        element={
          <PageTitle.Provider value="Dashboard">
            <ProtectedRoute audience="everyone">
              <CompanyDashboardPage />
            </ProtectedRoute>
          </PageTitle.Provider>
        }
      />

      <Route path={NOT_FOUND_PATH} element={<NotFoundPage />} />
    </Routes>
  );
}

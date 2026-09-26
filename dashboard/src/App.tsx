import { Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { landingFor } from '@ledova/shared';
import { useAuth } from '@hooks/useAuth';
import { useRole } from '@hooks/useRole';
import NotFoundPage from '@pages/NotFound';
import { RootRedirect } from './routes/RootRedirect';
import { PAGES } from './routes/pages';
import { signedInRoutes } from './routes/signedInRoutes';
import { signupRoutes } from './routes/signupRoutes';
import SignInPage from '@pages/signin';
import { SignupUser } from '@pages/signup/user';
import { SignupEmailConfirmation } from '@pages/signup/email-confirmation';
import { SignupPreScreening } from '@pages/signup/pre-screening';
import { SignupIdentityVerification } from '@pages/signup/identity-verification';
import { SignupUserProfile } from '@pages/signup/user-profile/SignupUserProfile';
import { SignupFinancialProfile } from '@pages/signup/financial-profile';
import { SignupReview } from '@pages/signup/review';

import { SignupAccountType } from '@pages/signup/account-type';
import { SignupCompanyRegistration } from '@pages/signup/company-registration';
import Layout from '@components/Layout';

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-raised">
      <div className="h-8 w-8 border-4 border-brand-subtle border-t-brand rounded-full animate-spin" />
    </div>
  );
}

interface RouteGuardProps {
  children: ReactNode;
}

function PublicOnlyRoute({ children }: RouteGuardProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const { role, isLoading: isRoleLoading } = useRole();
  if (isLoading || (isAuthenticated && isRoleLoading)) return <LoadingSpinner />;
  if (isAuthenticated) return <Navigate to={landingFor(role)} replace />;
  return <>{children}</>;
}

const SIGNED_IN_ROUTES = signedInRoutes(PAGES);

const SIGNUP_ROUTES = signupRoutes({
  '/signup/email-confirmation': <SignupEmailConfirmation />,
  '/signup/account-type': <SignupAccountType />,
  '/signup/pre-screening': <SignupPreScreening />,
  '/signup/identity-verification': <SignupIdentityVerification />,
  '/signup/user-profile': <SignupUserProfile />,
  '/signup/financial-profile': <SignupFinancialProfile />,
  '/signup/company-registration': <SignupCompanyRegistration />,
  '/signup/review': <SignupReview />,
});

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<RootRedirect />} />

        <Route
          path="/signin"
          element={
            <PublicOnlyRoute>
              <SignInPage />
            </PublicOnlyRoute>
          }
        />

        <Route
          path="/signup"
          element={
            <PublicOnlyRoute>
              <SignupUser />
            </PublicOnlyRoute>
          }
        />
        {SIGNUP_ROUTES}

        {SIGNED_IN_ROUTES}

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}

export default App;

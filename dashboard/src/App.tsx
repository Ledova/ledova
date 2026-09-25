import { Routes, Route, Navigate } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { landingFor, type DestinationKey } from '@ledova/shared';
import { useAuth, useFeatureFlags, useRole } from '@hooks';
import NotFoundPage from '@pages/NotFound';
import { RootRedirect } from './routes/RootRedirect';
import { signedInRoutes } from './routes/signedInRoutes';
import { SignupRoute } from './routes/SignupRoute';
import HomePage from '@pages/home';

import SignInPage from '@pages/signin';
import { SignupUser } from '@pages/signup/user';
import { SignupEmailConfirmation } from '@pages/signup/email-confirmation';
import { SignupPreScreening } from '@pages/signup/pre-screening';
import { SignupIdentityVerification } from '@pages/signup/identity-verification';
import { SignupUserProfile } from '@pages/signup/user-profile/SignupUserProfile';
import { SignupFinancialProfile } from '@pages/signup/financial-profile';
import { SignupReview } from '@pages/signup/review';
import UserProfilePage from '@pages/user-profile';
import WalletsPage from '@pages/wallets';
import TransactionsPage from '@pages/transactions';
import AssetPricesPage from '@pages/asset-prices';
import SettingsPage from '@pages/settings';
import TradingPage from '@pages/trading';
import CompanyPage from '@pages/company';
import InvestorEligibilityPage from '@pages/investor-eligibility';

import ListingPage from '@pages/company/listing';
import OfferingPage from '@pages/company/offering';
import DirectoryPage from '@pages/directory';
import DirectoryTokenPage from '@pages/directory/detail';
import SubscriptionsPage from '@pages/subscriptions';
import SubscriptionDetailPage from '@pages/subscriptions/detail';
import PublicationsPage from '@pages/publications';
import DividendsPage from '@pages/dividends';
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

function TradingRoute() {
  const { tradingEnabled, isLoading } = useFeatureFlags();
  const { role } = useRole();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!tradingEnabled) {
    return <Navigate to={landingFor(role)} replace />;
  }

  return <TradingPage />;
}

function PublicOnlyRoute({ children }: RouteGuardProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const { role, isLoading: isRoleLoading } = useRole();
  if (isLoading || (isAuthenticated && isRoleLoading)) return <LoadingSpinner />;
  if (isAuthenticated) return <Navigate to={landingFor(role)} replace />;
  return <>{children}</>;
}

const PAGES: Record<DestinationKey, ReactElement> = {
  home: <HomePage />,
  wallets: <WalletsPage />,
  transactions: <TransactionsPage />,
  assetPrices: <AssetPricesPage />,
  trading: <TradingRoute />,
  directory: <DirectoryPage />,
  directoryDetail: <DirectoryTokenPage />,
  subscriptions: <SubscriptionsPage />,
  subscriptionDetail: <SubscriptionDetailPage />,
  investorEligibility: <InvestorEligibilityPage />,
  publications: <PublicationsPage />,
  dividends: <DividendsPage />,
  company: <CompanyPage />,
  companyListing: <ListingPage />,
  companyOffering: <OfferingPage />,
  userProfile: <UserProfilePage />,
  settings: <SettingsPage />,
};

const SIGNED_IN_ROUTES = signedInRoutes(PAGES);

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
        <Route element={<SignupRoute />}>
          <Route path="/signup/email-confirmation" element={<SignupEmailConfirmation />} />
          <Route path="/signup/account-type" element={<SignupAccountType />} />
          <Route path="/signup/pre-screening" element={<SignupPreScreening />} />
          <Route path="/signup/identity-verification" element={<SignupIdentityVerification />} />
          <Route path="/signup/user-profile" element={<SignupUserProfile />} />
          <Route path="/signup/financial-profile" element={<SignupFinancialProfile />} />
          <Route path="/signup/company-registration" element={<SignupCompanyRegistration />} />
          <Route path="/signup/review" element={<SignupReview />} />
        </Route>

        {SIGNED_IN_ROUTES}

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}

export default App;

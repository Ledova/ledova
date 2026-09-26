import type { ReactElement } from 'react';
import type { DestinationKey } from '@ledova/shared';
import HomePage from '@pages/home';
import WalletsPage from '@pages/wallets';
import TransactionsPage from '@pages/transactions';
import DirectoryPage from '@pages/directory';
import DirectoryTokenPage from '@pages/directory/detail';
import SubscriptionsPage from '@pages/subscriptions';
import SubscriptionDetailPage from '@pages/subscriptions/detail';
import InvestorEligibilityPage from '@pages/investor-eligibility';
import PublicationsPage from '@pages/publications';
import DividendsPage from '@pages/dividends';
import CompanyPage from '@pages/company';
import ListingPage from '@pages/company/listing';
import OfferingPage from '@pages/company/offering';
import UserProfilePage from '@pages/user-profile';
import SettingsPage from '@pages/settings';
import { TradingRoute } from './TradingRoute';

export const PAGES: Record<DestinationKey, ReactElement> = {
  home: <HomePage />,
  wallets: <WalletsPage />,
  transactions: <TransactionsPage />,
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

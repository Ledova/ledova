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
import CompanyPage from '@pages/company';
import CompanyAuthorityPage from '@pages/company/authority';
import CompanyTeamPage from '@pages/company/team';
import ShareClassPage from '@pages/company/classes';
import CompanyRegisterPage from '@pages/company/register';
import CompanyRegisterImportPage from '@pages/company/register/import';
import CompanyRegisterCorrectionPage from '@pages/company/register/correct';
import CompanyRegisterOpeningPage from '@pages/company/register/open';
import ListingPage from '@pages/company/listing';
import IssuerPublicationsPage from '@pages/company/publications';
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
  companyClass: <ShareClassPage />,
  companyRegister: <CompanyRegisterPage />,
  companyRegisterImport: <CompanyRegisterImportPage />,
  companyRegisterCorrection: <CompanyRegisterCorrectionPage />,
  companyRegisterOpening: <CompanyRegisterOpeningPage />,
  company: <CompanyPage />,
  companyAuthority: <CompanyAuthorityPage />,
  companyTeam: <CompanyTeamPage />,
  companyListing: <ListingPage />,
  companyPublications: <IssuerPublicationsPage />,
  companyOffering: <OfferingPage />,
  userProfile: <UserProfilePage />,
  settings: <SettingsPage />,
};

import type { ReactElement } from 'react';
import type { DestinationKey } from '@ledova/shared';
import MemberRecordsPage from '@pages/home';
import HomePage from '@pages/wallets/holdings';
import WalletsPage from '@pages/wallets';
import TransactionsPage from '@pages/transactions';
import DirectoryPage from '@pages/directory';
import DirectoryTokenPage from '@pages/directory/detail';
import SubscriptionsPage from '@pages/subscriptions';
import SubscriptionDetailPage from '@pages/subscriptions/detail';
import InvestorEligibilityPage from '@pages/investor-eligibility';
import ParticipantEligibilityPage from '@pages/eligibility-requests';
import CompanyEligibilityPage from '@pages/company/eligibility';
import PublicationsPage from '@pages/publications';
import CompanyPage from '@pages/company';
import CompanyAuthorityPage from '@pages/company/authority';
import CompanyTeamPage from '@pages/company/team';
import ShareClassPage from '@pages/company/ledger/detail';
import CompanyRegisterPage from '@pages/company/ledger';
import CompanyRegisterImportPage from '@pages/company/ledger/import';
import CompanyRegisterCorrectionPage from '@pages/company/ledger/correct';
import CompanyRegisterLinksPage from '@pages/company/ledger/links';
import CompanyRegisterOpeningPage from '@pages/company/ledger/open';
import CompanyRegisterParticularsPage from '@pages/company/ledger/particulars';
import CompanyShareholderPage from '@pages/company/ledger/member';
import CompanyRegisterAwardPage from '@pages/company/ledger/award';
import CompanyRegisterTransferPage from '@pages/company/ledger/transfer';
import ListingPage from '@pages/company/listing';
import IssuerPublicationsPage from '@pages/company/publications';
import OfferingPage from '@pages/company/offering';
import UserProfilePage from '@pages/user-profile';
import SettingsPage from '@pages/settings';
import { TradingRoute } from './TradingRoute';

export const PAGES: Record<DestinationKey, ReactElement> = {
  home: <MemberRecordsPage />,
  walletHoldings: <HomePage />,
  memberRecords: <MemberRecordsPage />,
  wallets: <WalletsPage />,
  transactions: <TransactionsPage />,
  trading: <TradingRoute />,
  directory: <DirectoryPage />,
  directoryDetail: <DirectoryTokenPage />,
  subscriptions: <SubscriptionsPage />,
  subscriptionDetail: <SubscriptionDetailPage />,
  investorEligibility: <InvestorEligibilityPage />,
  eligibilityRequests: <ParticipantEligibilityPage />,
  companyEligibility: <CompanyEligibilityPage />,
  publications: <PublicationsPage />,
  companyClass: <ShareClassPage />,
  companyRegister: <CompanyRegisterPage />,
  companyRegisterSetup: <CompanyRegisterImportPage />,
  companyRegisterImport: <CompanyRegisterImportPage />,
  companyRegisterCorrection: <CompanyRegisterCorrectionPage />,
  companyRegisterLinks: <CompanyRegisterLinksPage />,
  companyRegisterOpening: <CompanyRegisterOpeningPage />,
  companyRegisterParticulars: <CompanyRegisterParticularsPage />,
  companyShareholder: <CompanyShareholderPage />,
  companyRegisterAward: <CompanyRegisterAwardPage />,
  companyRegisterTransfer: <CompanyRegisterTransferPage />,
  company: <CompanyPage />,
  companyAuthority: <CompanyAuthorityPage />,
  companyTeam: <CompanyTeamPage />,
  companyListing: <ListingPage />,
  companyPublications: <IssuerPublicationsPage />,
  companyOffering: <OfferingPage />,
  userProfile: <UserProfilePage />,
  settings: <SettingsPage />,
};

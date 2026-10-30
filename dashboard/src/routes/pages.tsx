import type { ReactElement } from 'react';
import type { DestinationKey } from '@ledova/shared';
import MemberRecordsPage from '@pages/home';
import InvestorEligibilityPage from '@pages/investor-eligibility';
import ParticipantEligibilityPage from '@pages/eligibility-requests';
import CompanyEligibilityPage from '@pages/company/eligibility';
import PublicationsPage from '@pages/publications';
import CompanyPage from '@pages/company';
import CompanyAuthorityPage from '@pages/company/authority';
import CompanyAuthorityRequestPage from '@pages/company/authority/request';
import CompanyTeamPage from '@pages/company/team';
import ShareClassPage from '@pages/company/ledger/detail';
import CompanyClassChainPage from '@pages/company/ledger/chain';
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
import UserProfilePage from '@pages/user-profile';
import SettingsPage from '@pages/settings';

export const PAGES: Record<DestinationKey, ReactElement> = {
  home: <MemberRecordsPage />,
  memberRecords: <MemberRecordsPage />,
  investorEligibility: <InvestorEligibilityPage />,
  eligibilityRequests: <ParticipantEligibilityPage />,
  companyEligibility: <CompanyEligibilityPage />,
  publications: <PublicationsPage />,
  companyClass: <ShareClassPage />,
  companyClassChain: <CompanyClassChainPage />,
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
  companyAuthorityRequest: <CompanyAuthorityRequestPage />,
  companyTeam: <CompanyTeamPage />,
  companyListing: <ListingPage />,
  companyPublications: <IssuerPublicationsPage />,
  userProfile: <UserProfilePage />,
  settings: <SettingsPage />,
};

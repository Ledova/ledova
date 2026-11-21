import type { ReactElement } from 'react';
import type { DestinationKey } from '@ledova/shared';
import {
  CompanyAuthorityPage,
  CompanyAuthorityRequestPage,
  CompanyPage,
  CompanyRegisterAwardPage,
  CompanyRegisterPage,
  CompanyRegisterParticularsPage,
  CompanyRegisterTransferPage,
  CompanyShareholderPage,
  CompanyTeamPage,
  CertificatesPage,
  DashboardPage,
  SettingsPage,
  ShareClassPage,
  UserProfilePage,
} from './lazyPages';

export const PAGES: Record<DestinationKey, ReactElement> = {
  home: <DashboardPage />,
  memberRecords: <DashboardPage />,
  companyClass: <ShareClassPage />,
  companyRegister: <CompanyRegisterPage />,
  companyRegisterSetup: <ShareClassPage />,
  companyRegisterImport: <ShareClassPage />,
  companyRegisterParticulars: <CompanyRegisterParticularsPage />,
  companyShareholder: <CompanyShareholderPage />,
  companyRegisterAward: <CompanyRegisterAwardPage />,
  companyRegisterTransfer: <CompanyRegisterTransferPage />,
  company: <CompanyPage />,
  companyAuthority: <CompanyAuthorityPage />,
  companyAuthorityRequest: <CompanyAuthorityRequestPage />,
  companyTeam: <CompanyTeamPage />,
  certificates: <CertificatesPage />,
  userProfile: <UserProfilePage />,
  settings: <SettingsPage />,
};

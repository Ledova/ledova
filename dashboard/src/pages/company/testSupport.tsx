import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PageTitle } from '@components/PageTitle';
import apiClient from '@services/apiClient';
import { ApiClientProvider, DESTINATIONS, type Company, type CompanyDocument, type DocumentType } from '@ledova/shared';

export function companyRecord(overrides: Partial<Company> = {}): Company {
  return {
    uuid: 'company-one',
    name: 'Harbour Example Pty Ltd',
    tradingName: 'Harbour Example',
    displayName: 'Harbour Example',
    acn: '000000019',
    abn: '53004085616',
    companyType: 'pty',
    companyTypeDisplay: 'Proprietary limited',
    status: 'draft',
    statusDisplay: 'Draft',
    email: 'company@example.invalid',
    phone: '0000000000',
    addressLine1: '1 Example Street',
    city: 'Example City',
    state: 'NSW',
    postcode: '2000',
    country: 'Australia',
    documents: [],
    operatorWallet: '',
    submittedAt: null,
    reviewStartedAt: null,
    approvedAt: null,
    activatedAt: null,
    infoRequestedAt: null,
    infoRequestReason: '',
    additionalInfoResponse: '',
    rejectionAt: null,
    rejectionReason: '',
    withdrawnAt: null,
    withdrawalReason: '',
    isActive: false,
    isApproved: false,
    isPendingReview: false,
    canIssueTokens: false,
    isOpenToInvestors: false,
    primaryContact: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

export function documentRecord(type: DocumentType, uuid: string = type): CompanyDocument {
  return {
    uuid,
    name: `${uuid}.pdf`,
    documentType: type,
    documentTypeDisplay: type,
    fileUrl: `https://example.invalid/files/${uuid}`,
    fileSize: 12,
    mimeType: 'application/pdf',
    isVerified: false,
    verifiedAt: null,
    createdAt: '2026-09-01T00:00:00Z',
  };
}

export function renderCompanyPage(client: QueryClient, page: ReactNode, title: string) {
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <MemoryRouter>
          <PageTitle.Provider value={title}>
            <Routes>
              <Route path="/" element={page} />
              <Route path={DESTINATIONS.company.path} element={<p>Company page</p>} />
              <Route path={DESTINATIONS.companyRegister.path} element={<p>Register page</p>} />
            </Routes>
          </PageTitle.Provider>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

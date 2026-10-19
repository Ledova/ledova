// @vitest-environment jsdom

import { COMPANY_TOKEN_ENDPOINTS, type Company, type CompanyDocument } from '@ledova/shared';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CompanyPage from '.';
import { companyRecord, renderCompanyPage } from '../../testSupport/company';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const COMPANY = '/api/v1/companies/company-one/';
const CLASSES = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const EMPTY = { results: [], next: null, previous: null, count: 0 };
let client: QueryClient;
let company: Company;
let failed: string | null;
function show() {
  return renderCompanyPage(client, <CompanyPage />, 'Company');
}
beforeEach(() => {
  vi.resetAllMocks();
  failed = null;
  company = companyRecord();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.get.mockImplementation(async (url: string) => {
    if (url === failed) throw new Error('Unavailable');
    if (url === '/api/v1/companies/') return { data: { ...EMPTY, results: [company] } };
    if (url === COMPANY) return { data: { ...company } };
    throw new Error(`Unexpected request: ${url}`);
  });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockImplementation(async (_url, changes) => {
    company = { ...company, ...changes };
    return { data: { ...company } };
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it('shows company details and destinations without share classes, and uploads documents to the selected company and type', async () => {
  show();
  await screen.findByText(company.name);
  expect(screen.getByText(/Company information is provided by the company/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /Company team/ }).getAttribute('href')).toBe('/company/team');
  expect(screen.getByText('company@example.invalid')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Activation' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Published to your members' }).getAttribute('href')).toBe(
    '/company/publications',
  );
  expect(screen.getByRole('button', { name: 'Edit company' })).toBeTruthy();
  expect(screen.queryByText(/Share classes/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create share class' })).toBeNull();
  const file = new File(['Synthetic company supporting copy'], 'company-constitution.pdf', { type: 'application/pdf' });
  const document: CompanyDocument = {
    uuid: 'document-one',
    company: company.uuid,
    documentType: 'constitution',
    documentTypeDisplay: 'Company Constitution',
    name: file.name,
    fileUrl: '/private/company-constitution.pdf',
    createdAt: '2026-10-14T00:00:00Z',
    isVerified: false,
    verifiedAt: null,
  };
  api.post.mockImplementation(async (url: string, body: FormData, config: { ledovaSubmissionGuard: () => void }) => {
    config.ledovaSubmissionGuard();
    expect(url).toBe(`${COMPANY}documents/`);
    expect(body.get('document_type')).toBe('constitution');
    expect(body.get('name')).toBe(file.name);
    expect((body.get('file') as File).name).toBe(file.name);
    expect((body.get('file') as File).size).toBe(file.size);
    company = { ...company, documents: [document] };
    return { data: document };
  });
  fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'constitution' } });
  fireEvent.click(screen.getByRole('button', { name: 'Upload document' }));
  const dialog = await screen.findByRole('dialog', { name: 'Upload Company Constitution' });
  fireEvent.change(within(dialog).getByLabelText('Document file'), { target: { files: [file] } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Upload Company Constitution' })).toBeNull());
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('link', { name: `View ${file.name}` }).getAttribute('href')).toBe(document.fileUrl);
  expect(screen.queryByRole('option', { name: 'Company Constitution' })).toBeNull();
  expect(screen.getByRole('option', { name: 'Other documents' })).toBeTruthy();
  expect((screen.getByLabelText('Document type') as HTMLSelectElement).value).toBe('other');
  expect(api.get.mock.calls.map(([url]) => url)).not.toContain(CLASSES);
});

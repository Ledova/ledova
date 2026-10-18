// @vitest-environment jsdom

import { COMPANY_TOKEN_ENDPOINTS, type Company, type CompanyDocument } from '@ledova/shared';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CompanyPage from '.';
import { REGISTER_QUERY_KEY } from '@hooks/useRegisterAccess';
import { companyRecord, renderCompanyPage } from '../../testSupport/company';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const COMPANY = '/api/v1/companies/company-one/';
const CLASSES = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const EMPTY = { results: [], next: null, previous: null, count: 0 };
let client: QueryClient;
let company: Company;
let failed: string | null;
const shareClass = {
  uuid: 'class-one',
  companyUuid: 'company-one',
  name: 'Ordinary shares',
  symbol: 'ORD',
  tokenType: 'ordinary',
  tokenTypeDisplay: 'Ordinary',
  status: 'draft',
  statusDisplay: 'Draft',
  totalSupply: '9007199254740993',
};
let shareClasses = [shareClass];
function show() {
  return renderCompanyPage(client, <CompanyPage />, 'Company');
}
beforeEach(() => {
  vi.resetAllMocks();
  failed = null;
  shareClasses = [shareClass];
  company = companyRecord();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.get.mockImplementation(async (url: string) => {
    if (url === failed) throw new Error('Unavailable');
    if (url === '/api/v1/companies/') return { data: { ...EMPTY, results: [company] } };
    if (url === COMPANY) return { data: { ...company } };
    if (url === CLASSES) return { data: { ...EMPTY, count: shareClasses.length, results: shareClasses } };
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

it('shows exact company classes and destinations, and uploads documents to the selected company and type', async () => {
  show();
  await screen.findByText(company.name);
  expect(screen.getByText(/Company information is provided by the company/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /Company team/ }).getAttribute('href')).toBe('/company/team');
  expect(screen.getByText('company@example.invalid')).toBeTruthy();
  expect(await screen.findByText('Technical share limit · 9,007,199,254,740,993')).toBeTruthy();
  expect(screen.queryByText('Technical share limit · Internal quantity guard')).toBeNull();
  expect(screen.getByRole('link', { name: 'Ordinary shares' }).getAttribute('href')).toBe(
    '/company/register/class-one',
  );
  expect(screen.getByRole('link', { name: 'Activation' }).getAttribute('href')).toBe('/company/listing');
  expect(screen.getByRole('link', { name: 'Published to your members' }).getAttribute('href')).toBe(
    '/company/publications',
  );
  expect(screen.getByRole('link', { name: 'Register' }).getAttribute('href')).toBe('/company/register');
  expect(screen.getByRole('button', { name: 'Edit company' })).toBeTruthy();
  shareClasses = [
    { ...shareClass, status: 'deploying', statusDisplay: 'Deploying' },
    { ...shareClass, uuid: 'mirror-class', name: 'Mirror shares', totalSupply: (2n ** 256n - 1n).toString() },
  ];
  await act(async () => {
    await client.invalidateQueries({ queryKey: REGISTER_QUERY_KEY });
  });
  expect(await screen.findByText('Deploying')).toBeTruthy();
  expect(screen.getByText('Technical share limit · 9,007,199,254,740,993')).toBeTruthy();
  expect(screen.getByText('Technical share limit · Internal quantity guard')).toBeTruthy();
  expect(screen.queryByText(`${(2n ** 256n - 1n).toLocaleString()} authorised shares`)).toBeNull();
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
  cleanup();
  client.clear();
  company = companyRecord({ isOwner: false });
  api.post.mockClear();
  api.post.mockImplementation(async (url, body, config) => {
    config.ledovaSubmissionGuard();
    expect(url).toBe(COMPANY_TOKEN_ENDPOINTS.BASE);
    expect(body).toEqual({
      company: company.uuid,
      name: 'Employee shares',
      symbol: 'EMP',
      tokenType: 'ordinary',
      totalSupply: '1000',
    });
    return { data: { ...shareClass, ...body } };
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Create share class' }));
  const classDialog = await screen.findByRole('dialog', { name: 'Create share class' });
  expect(within(classDialog).getByText(/not statutory authorised capital/)).toBeTruthy();
  for (const [label, value] of [
    ['Class name', 'Employee shares'],
    ['Class code', 'EMP'],
    ['Technical share limit', '1000'],
  ])
    fireEvent.change(within(classDialog).getByLabelText(label), { target: { value } });
  fireEvent.click(within(classDialog).getByRole('button', { name: 'Create share class' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.post).toHaveBeenCalledOnce();
  expect(api.get.mock.calls.map(([url]) => url)).not.toContain(COMPANY_TOKEN_ENDPOINTS.BASE);
});

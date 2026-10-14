// @vitest-environment jsdom

import { COMPANY_TOKEN_ENDPOINTS, type Company } from '@ledova/shared';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CompanyPage from '.';
import { companyRecord, renderCompanyPage } from './testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const COMPANY = '/api/v1/companies/company-one/';
const CLASSES = COMPANY_TOKEN_ENDPOINTS.BASE;
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
    if (url === CLASSES) return { data: { ...EMPTY, count: 1, results: [shareClass] } };
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

it('shows company details, exact draft share classes and the class/application destinations', async () => {
  show();
  await screen.findByText(company.name);
  expect(screen.getByText(/Company information is provided by the company/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /Company team/ }).getAttribute('href')).toBe('/company/team');
  expect(screen.getByText('company@example.invalid')).toBeTruthy();
  expect(await screen.findByText('Internal quantity guard')).toBeTruthy();
  expect(screen.queryByText('9,007,199,254,740,993 authorised shares')).toBeNull();
  expect(screen.getByRole('link', { name: 'Ordinary shares' }).getAttribute('href')).toBe(
    '/company/register/class-one',
  );
  expect(screen.getByRole('link', { name: 'Activation' }).getAttribute('href')).toBe('/company/listing');
  expect(screen.getByRole('link', { name: 'Published to your members' }).getAttribute('href')).toBe(
    '/company/publications',
  );
  expect(screen.getByRole('link', { name: 'Register' }).getAttribute('href')).toBe('/company/register');
  expect(screen.getByRole('button', { name: 'Edit company' })).toBeTruthy();
});

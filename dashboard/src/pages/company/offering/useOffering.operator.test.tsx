// @vitest-environment jsdom

import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const operator = vi.hoisted(() => ({ name: 'Example Operator' }));
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

const resolved = (results: unknown[]) => () => Promise.resolve({ data: { results } });

vi.mock('@ledova/shared', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@ledova/shared');
  return {
    ...actual,
    getOfferings: resolved([]),
    getCompanyTokens: resolved([]),
    getOperator: () => Promise.resolve({ data: { name: operator.name, supportedSettlementAssets: [] } }),
  };
});

const { useOfferings } = await import('./useOffering');
const { useCompany } = await import('../hooks/useCompany');
const { companyRecord, renderCompanyPage } = await import('../testSupport');
let client: QueryClient;

function Probe() {
  const read = useCompany({ ownedOnly: true });
  const { operatorName, isLoading } = useOfferings(read.companyUuid, read);
  return <span>{isLoading || read.isLoading ? 'loading' : `named: ${operatorName}`}</span>;
}

function mount() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/v1/companies/')
      return { data: { results: [companyRecord()], count: 1, next: null, previous: null } };
    if (url === '/api/v1/companies/company-one/') return { data: companyRecord() };
    throw new Error(`Unexpected request: ${url}`);
  });
  return renderCompanyPage(client, <Probe />, 'Company offerings');
}

afterEach(() => {
  cleanup();
  client.clear();
});

it('names the operator from its record', async () => {
  operator.name = 'Example Operator';
  mount();

  expect(await screen.findByText('named: Example Operator')).toBeDefined();
});

it('says the operator when the record carries no name', async () => {
  operator.name = '';
  mount();

  expect(await screen.findByText('named: the operator')).toBeDefined();
});

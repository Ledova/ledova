// @vitest-environment jsdom

import { QueryClient } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const never = () => new Promise(() => {});
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

const resolved = (results: unknown[]) => () => Promise.resolve({ data: { results } });

vi.mock('@ledova/shared', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@ledova/shared');
  return {
    ...actual,
    getOfferings: resolved([{ uuid: 'offering-1', tokenUuid: 'token-one' }]),
    getCompanyTokens: resolved([{ uuid: 'token-one', companyUuid: 'company-one' }]),
    getOperator: never,
  };
});

const { useOfferings } = await import('./useOffering');
const { useCompany } = await import('../hooks/useCompany');
const { companyRecord, renderCompanyPage } = await import('../testSupport');
let client: QueryClient;

function Probe() {
  const read = useCompany({ ownedOnly: true });
  const { offerings, isLoading } = useOfferings(read.companyUuid, read);
  return (
    <span>
      offerings:{offerings.length} {isLoading || read.isLoading ? 'loading' : 'ready'}
    </span>
  );
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

describe('useOfferings loading state', () => {
  afterEach(() => {
    cleanup();
    client.clear();
  });

  it('is still loading after the other queries answer, while the operator has not', async () => {
    mount();

    await screen.findByText(/offerings:1/);

    expect(screen.getByText(/loading/)).toBeDefined();
    expect(screen.queryByText(/ready/)).toBeNull();
  });
});

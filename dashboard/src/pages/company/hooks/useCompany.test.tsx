// @vitest-environment jsdom

import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCompany } from './useCompany';
import { companyRecord } from '../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
let client: QueryClient;
const company = companyRecord();
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it('waits for the complete company instead of treating its list summary as loaded detail', async () => {
  let resolve: (value: unknown) => void = () => {};
  api.get.mockImplementation((url: string) =>
    url === '/api/v1/companies/'
      ? Promise.resolve({ data: { results: [{ uuid: company.uuid, name: company.name }] } })
      : new Promise((done) => {
          resolve = done;
        }),
  );
  const { result } = renderHook(() => useCompany(), { wrapper });
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/v1/companies/company-one/'));
  expect(result.current.company).toBeNull();
  expect(result.current.isLoading).toBe(true);
  await act(async () => resolve({ data: company }));
  await waitFor(() => expect(result.current.company).toEqual(company));
  expect(api.get.mock.calls.map(([url]) => url)).toEqual(['/api/v1/companies/', '/api/v1/companies/company-one/']);
});

it.each(['list', 'detail'])('reports and retries a failed %s read', async (source) => {
  let failed = true;
  const error = new Error('Unavailable');
  api.get.mockImplementation(async (url: string) => {
    if (failed && (source === 'list' ? url === '/api/v1/companies/' : url.endsWith('company-one/'))) throw error;
    return { data: url === '/api/v1/companies/' ? { results: [{ uuid: company.uuid }] } : company };
  });
  const { result } = renderHook(() => useCompany(), { wrapper });
  await waitFor(() => expect(result.current.error).toBe(error));
  expect(result.current.company).toBeNull();
  failed = false;
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.company).toEqual(company));
  expect(result.current.error).toBeNull();
});

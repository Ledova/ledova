import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import { useCompanyProfile } from './useCompanyProfile';

jest.mock('../services/apiClient', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('./useUserPreferences', () => ({
  useUserPreferences: () => ({ userAccount: { role: 'company' }, isLoading: false, isError: false }),
}));
const get = jest.mocked(apiClient.get);
const summary = { uuid: 'company-1', name: 'Synthetic Company', status: 'draft' };
let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  get.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

it('does not use an incomplete summary when the company detail fails', async () => {
  const failure = new Error('detail unavailable');
  get.mockImplementation((url: string) =>
    url === '/api/v1/companies/' ? Promise.resolve({ data: { results: [summary] } }) : Promise.reject(failure),
  );
  const { result } = await renderHook(() => useCompanyProfile(), { wrapper });
  await waitFor(() => expect(result.current.error).toBe(failure));
  expect(result.current.company).toBeNull();
  expect(result.current.companyUuid).toBe('company-1');
  expect(get).not.toHaveBeenCalledWith(expect.stringContaining('/stats/'));
});

it('refreshes list and full detail and exposes failed list reads over cached detail', async () => {
  const detail = { ...summary, abn: 'fictional', documents: [] };
  let failing = false;
  get.mockImplementation((url: string) =>
    url === '/api/v1/companies/' && failing
      ? Promise.reject(new Error('list refused'))
      : Promise.resolve({ data: url === '/api/v1/companies/' ? { results: [summary] } : detail }),
  );
  const { result } = await renderHook(() => useCompanyProfile(), { wrapper });
  await waitFor(() => expect(result.current.company).toEqual(detail));
  failing = true;
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.error?.message).toBe('list refused'));
  expect(get.mock.calls.filter(([url]) => url === '/api/v1/companies/')).toHaveLength(2);
  expect(get.mock.calls.filter(([url]) => url === '/api/v1/companies/company-1/')).toHaveLength(2);
  failing = false;
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.error).toBeNull());
});

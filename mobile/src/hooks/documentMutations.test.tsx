import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { apiClient } from '../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../services/sessionScope';
import { companyDetail, companyPreferences, companyQueryClient } from '../testSupport/companyAdministration';
import { useCompanyDocuments } from '../screens/listing/useCompanyDocuments';
import { useInvestorEligibility } from '../screens/investor-eligibility/useInvestorEligibility';

jest.mock('../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
const post = jest.mocked(apiClient.post);
let client: QueryClient;
beforeEach(() => {
  client = companyQueryClient();
  jest
    .mocked(apiClient.get)
    .mockReset()
    .mockImplementation(async (url) => ({
      data: url === '/api/v1/companies/' ? { results: [companyDetail()], next: null } : companyDetail(),
    }));
  post.mockReset().mockResolvedValue({
    data: { uuid: 'document', company: 'company-a', documentType: 'cert_inc', name: 'evidence.pdf' },
  });
});
afterEach(async () => {
  await cleanup();
  client.clear();
});
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
function pauseMutation() {
  let entered!: () => void;
  let resume!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    mutations: {
      retry: false,
      gcTime: 0,
      onMutate: async () => {
        entered();
        await resumed;
      },
    },
  });
  return { started, resume };
}

it('refuses the original company upload when React Query replaces mutation options after an acting-account change', async () => {
  const pause = pauseMutation();
  const invalidated = jest.spyOn(client, 'invalidateQueries');
  const view = await renderHook(() => useCompanyDocuments(), { wrapper });
  await waitFor(() => expect(view.result.current.canAdmin).toBe(true));
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = view.result.current.upload({
      companyUuid: 'company-a',
      sessionEpoch: getSessionEpoch(),
      documentType: 'cert_inc',
      name: 'evidence.pdf',
      file: {},
      assertCurrent: () => {},
    });
    await pause.started;
  });
  const refused = expect(pending).rejects.toThrow();
  await act(() => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: companyPreferences('company', 'b') }));
  await view.rerender({});
  await act(async () => {
    pause.resume();
    await refused;
  });
  expect(post).not.toHaveBeenCalled();
  expect(invalidated).not.toHaveBeenCalled();
});

it('rejects a late company upload receipt without invalidating a newer session', async () => {
  let finish!: () => void;
  post.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({ data: { uuid: 'document', company: 'company-a', documentType: 'cert_inc', name: 'evidence.pdf' } });
      }),
  );
  const invalidated = jest.spyOn(client, 'invalidateQueries');
  const view = await renderHook(() => useCompanyDocuments(), { wrapper });
  await waitFor(() => expect(view.result.current.canAdmin).toBe(true));
  let pending!: Promise<unknown>;
  await act(async () => {
    pending = view.result.current.upload({
      companyUuid: 'company-a',
      sessionEpoch: getSessionEpoch(),
      documentType: 'cert_inc',
      name: 'evidence.pdf',
      file: {},
      assertCurrent: () => {},
    });
  });
  const refused = expect(pending).rejects.toThrow();
  expect(post).toHaveBeenCalledTimes(1);
  await act(async () => {
    invalidateSessionScope();
    finish();
    await refused;
  });
  expect(invalidated).not.toHaveBeenCalled();
});

it('forwards the eligibility session fence and suppresses stale completion invalidation', async () => {
  let finish!: () => void;
  post.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ data: {} });
      }),
  );
  const invalidated = jest.spyOn(client, 'invalidateQueries');
  const view = await renderHook(() => useInvestorEligibility(), { wrapper });
  let pending!: Promise<unknown>;
  const epoch = getSessionEpoch();
  await act(async () => {
    pending = view.result.current!.submitClaim({
      sessionEpoch: epoch,
      category: 'product_value',
      declaredBasis: 'Synthetic evidence',
      file: {},
    });
  });
  expect(post).toHaveBeenCalledWith(
    expect.any(String),
    expect.any(FormData),
    expect.objectContaining({ ledovaSessionEpoch: epoch }),
  );
  await act(async () => {
    invalidateSessionScope();
    finish();
    await pending;
  });
  expect(invalidated).not.toHaveBeenCalled();
});

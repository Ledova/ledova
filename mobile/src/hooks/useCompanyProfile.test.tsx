import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import { useCompanyProfile } from './useCompanyProfile';
import { ApiClientProvider, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { companyDetail, companyPreferences, companyQueryClient } from '../testSupport/companyAdministration';

jest.mock('../services/apiClient', () => ({ apiClient: { get: jest.fn() } }));
const get = jest.mocked(apiClient.get);
const summary = companyDetail({ uuid: 'company-1' });
let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  get.mockReset();
  client = companyQueryClient();
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

it('does not use an incomplete summary when the company detail fails', async () => {
  const failure = new Error('detail unavailable');
  get.mockImplementation((url: string) =>
    url === '/api/v1/companies/'
      ? Promise.resolve({ data: { results: [summary], next: null } })
      : Promise.reject(failure),
  );
  const { result } = await renderHook(() => useCompanyProfile(), { wrapper });
  await waitFor(() => expect(result.current.error).toBe(failure));
  expect(result.current.company).toBeNull();
  expect(result.current.companyUuid).toBe('company-1');
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
  await waitFor(() => expect(result.current.error).toBeFalsy());
});

it('reads every company page and waits for explicit selection when there are multiple eligible companies', async () => {
  const other = companyDetail({ uuid: 'company-2', name: 'Second Company', isOwner: false });
  get.mockImplementation(async (url, config) => {
    if (url === '/api/v1/companies/')
      return {
        data: {
          results: (config?.params as { page?: number } | undefined)?.page === 2 ? [other] : [summary],
          next:
            (config?.params as { page?: number } | undefined)?.page === 2 ? null : 'https://api.example.test/?page=2',
        },
      };
    return { data: url.includes('company-2') ? other : summary };
  });
  const { result } = await renderHook(() => useCompanyProfile(), { wrapper });
  await waitFor(() => expect(result.current.companies).toHaveLength(2));
  expect(result.current.company).toBeNull();
  expect(get.mock.calls.filter(([url]) => url !== '/api/v1/companies/')).toHaveLength(0);
  await act(() => result.current.selectCompany(other.uuid));
  await waitFor(() => expect(result.current.company?.uuid).toBe(other.uuid));
  expect(() => result.current.assertCurrent(other.uuid)).not.toThrow();
  expect(() => result.current.assertCurrent(summary.uuid)).toThrow();
});

it('refuses a later company-list page without presenting the earlier page as a complete choice', async () => {
  get.mockImplementation(async (url, config) => {
    if ((config?.params as { page?: number } | undefined)?.page === 2) throw new Error('Later page refused');
    return { data: { results: [summary], next: 'https://api.example.test/?page=2' } };
  });
  const { result } = await renderHook(() => useCompanyProfile(), { wrapper });
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.companyUuid).toBeUndefined();
  expect(result.current.companies).toEqual([]);
  expect(get).toHaveBeenCalledTimes(2);
});

it('keeps a prior detail for draft display only after refresh refusal and denies actions', async () => {
  let fail = false;
  get.mockImplementation(async (url) => {
    if (fail && url !== '/api/v1/companies/') throw new Error('Detail refused');
    return { data: url === '/api/v1/companies/' ? { results: [summary], next: null } : summary };
  });
  const { result } = await renderHook(() => useCompanyProfile(), { wrapper });
  await waitFor(() => expect(result.current.canAdmin).toBe(true));
  fail = true;
  await act(() => result.current.refetch());
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.company).toBeNull();
  expect(result.current.retainedCompany).toEqual(summary);
  expect(() => result.current.assertCurrent(summary.uuid)).toThrow();
});

it('rejects an old acting-account guard and starts a separate company scope after account change', async () => {
  get.mockResolvedValue({ data: { results: [], next: null } });
  const { result } = await renderHook(() => useCompanyProfile(), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  const old = result.current.requestConfig('company-1').ledovaSubmissionGuard!;
  const scope = result.current.scopeKey;
  await act(() => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: companyPreferences('investor', 'b') }));
  await waitFor(() => expect(result.current.scopeKey).not.toBe(scope));
  expect(old).toThrow();
  expect(result.current.retainedCompany).toBeNull();
});

it.each([false, true])(
  'keeps retained current owner business reads without administration: owned only %s',
  async (ownedOnly) => {
    const owned = companyDetail({
      uuid: 'company-1',
      status: 'active',
      email: null,
      primaryContact: null,
      documents: [],
      administrativeAccess: { capabilities: [], draftSetup: false },
    });
    get.mockImplementation(async (url) => ({
      data: url === '/api/v1/companies/' ? { results: [owned], next: null } : owned,
    }));
    const { result } = await renderHook(() => useCompanyProfile({ ownedOnly }), { wrapper });
    await waitFor(() => expect(result.current.company?.uuid).toBe(owned.uuid));
    expect(result.current.ownerBusiness).toBe(true);
    expect(result.current.canAdmin).toBe(false);
    expect(result.current.company?.documents).toEqual([]);
    expect(result.current.company?.primaryContact).toBeNull();
    const held = result.current.requestConfig(owned.uuid, 'owner').ledovaSubmissionGuard!;
    expect(held).not.toThrow();
    expect(() => result.current.assertCurrent(owned.uuid)).toThrow();
    await act(() => client.setQueryData(result.current.companyKey, { ...owned, isOwner: false }));
    expect(held).toThrow();
    await waitFor(() => expect(result.current.ownerBusiness).toBe(false));
    await act(() => client.setQueryData(result.current.companyKey, owned));
    await waitFor(() => expect(result.current.ownerBusiness).toBe(true));
    await act(() => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: companyPreferences('investor') }));
    expect(held).toThrow();
    await waitFor(() => expect(result.current.company).toBeNull());
    expect(result.current.companies).toEqual([]);
  },
);

it.each(['admin', 'owner'] as const)('refuses list-only %s loss while the detail remains cached', async (mode) => {
  const initial: typeof summary = {
    ...summary,
    primaryContact: { fullName: 'Private owner contact' },
    documents: [
      {
        uuid: 'private-doc',
        company: summary.uuid,
        name: 'private.pdf',
        documentType: 'cert_inc',
        documentTypeDisplay: 'Certificate',
        fileUrl: 'https://example.invalid/private-doc',
        fileSize: 12,
        mimeType: 'application/pdf',
        isVerified: false,
        verifiedAt: null,
        createdAt: '2026-10-04T00:00:00Z',
      },
    ],
  };
  let listed = initial;
  get.mockImplementation(async (url) => ({
    data: url === '/api/v1/companies/' ? { results: [listed], next: null } : initial,
  }));
  const { result } = await renderHook(() => useCompanyProfile(), { wrapper });
  await waitFor(() => expect(result.current.canAdmin).toBe(true));
  const heldAdmin = result.current.requestConfig(initial.uuid).ledovaSubmissionGuard!;
  const heldOwner = result.current.requestConfig(initial.uuid, 'owner').ledovaSubmissionGuard!;
  const key = result.current.companyKey;
  listed =
    mode === 'admin'
      ? { ...initial, administrativeAccess: { capabilities: [], draftSetup: false } }
      : { ...initial, isOwner: false };
  await act(async () => {
    await client.invalidateQueries({ queryKey: result.current.companiesKey, exact: true });
  });
  expect(client.getQueryData(key)).toEqual(initial);
  expect(get.mock.calls.filter(([url]) => url !== '/api/v1/companies/')).toHaveLength(1);
  expect(result.current.company?.uuid).toBe(initial.uuid);
  if (mode === 'admin') {
    expect(heldAdmin).toThrow();
    await waitFor(() => expect(result.current.company?.documents).toEqual([]));
    expect(result.current.company?.email).toBeNull();
    expect(result.current.company?.primaryContact).toBeNull();
    expect(result.current.retainedCompany?.documents).toEqual([]);
    await waitFor(() => expect(result.current.canAdmin).toBe(false));
    expect(result.current.ownerBusiness).toBe(true);
    expect(heldOwner).not.toThrow();
  } else {
    expect(result.current.canAdmin).toBe(true);
    expect(heldAdmin).not.toThrow();
    expect(heldOwner).toThrow();
    await waitFor(() => expect(result.current.company?.isOwner).toBe(false));
    await waitFor(() => expect(result.current.ownerBusiness).toBe(false));
  }
});

// @vitest-environment jsdom

import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { useCompany } from './useCompany';
import { ApiClientProvider, AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { companyRecord, prepareCompanyClient } from '../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn() }));
const providedApi = Object.assign(axios.create(), api);
vi.mock('@services/apiClient', () => ({ default: api }));
let client: QueryClient;
const company = companyRecord();
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  prepareCompanyClient(client);
});
afterEach(() => {
  cleanup();
  client.clear();
});
function wrapper({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={providedApi}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

it('waits for the complete company instead of treating its list summary as loaded detail', async () => {
  let resolve: (value: unknown) => void = () => {};
  api.get.mockImplementation((url: string) =>
    url === '/api/v1/companies/'
      ? Promise.resolve({ data: { results: [company] } })
      : new Promise((done) => {
          resolve = done;
        }),
  );
  const { result } = renderHook(() => useCompany(), { wrapper });
  await waitFor(() =>
    expect(api.get).toHaveBeenCalledWith(
      '/api/v1/companies/company-one/',
      expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
    ),
  );
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
    return { data: url === '/api/v1/companies/' ? { results: [company] } : company };
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

function page(rows: unknown[], next: string | null = null) {
  return { data: { results: rows, next, count: rows.length, previous: null } };
}

it('reads every company page and requires an explicit choice before requesting either detail', async () => {
  const other = companyRecord({ uuid: 'company-two', name: 'Second company' });
  api.get.mockImplementation(async (url, config) => {
    if (url === '/api/v1/companies/')
      return config.params.page === 1 ? page([company], 'https://example.invalid/?page=2') : page([other]);
    return { data: url.endsWith('company-two/') ? other : company };
  });
  const { result } = renderHook(() => useCompany(), { wrapper });
  await waitFor(() => expect(result.current.companies).toHaveLength(2));
  expect(result.current.company).toBeNull();
  expect(api.get.mock.calls).toHaveLength(2);
  await act(async () => result.current.selectCompany(other.uuid));
  await waitFor(() => expect(result.current.company?.uuid).toBe(other.uuid));
  expect(api.get.mock.calls.map(([url]) => url)).not.toContain('/api/v1/companies/company-one/');
});

it('refuses a failed later page without loading partial company data, then retries every page', async () => {
  let failed = true;
  api.get.mockImplementation(async (url, config) => {
    if (url !== '/api/v1/companies/') return { data: company };
    if (config.params.page === 1) return page([company], 'https://example.invalid/?page=2');
    if (failed) throw new Error('Later page unavailable');
    return page([]);
  });
  const { result } = renderHook(() => useCompany(), { wrapper });
  await waitFor(() => expect(result.current.error?.message).toBe('Later page unavailable'));
  expect(result.current.company).toBeNull();
  expect(api.get.mock.calls.map(([url]) => url)).not.toContain('/api/v1/companies/company-one/');
  failed = false;
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.company?.uuid).toBe(company.uuid));
});

it.each(['duplicate', 'non-advancing', 'missing-id'])('refuses a %s company list', async (kind) => {
  api.get.mockImplementation(async () =>
    kind === 'non-advancing'
      ? page([company], 'https://example.invalid/?page=1')
      : page(kind === 'duplicate' ? [company, company] : [{ ...company, uuid: '' }]),
  );
  const { result } = renderHook(() => useCompany(), { wrapper });
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.company).toBeNull();
  expect(api.get.mock.calls).toHaveLength(1);
});

it('allows an investor-only appointed administrator without granting owner business access', async () => {
  prepareCompanyClient(client, 'investor');
  const assigned = companyRecord({ isOwner: false });
  api.get.mockImplementation(async (url) => (url === '/api/v1/companies/' ? page([assigned]) : { data: assigned }));
  const { result } = renderHook(() => useCompany(), { wrapper });
  await waitFor(() => expect(result.current.canAdmin).toBe(true));
  expect(result.current.ownerBusiness).toBe(false);
  expect(() => result.current.assertCurrent(company.uuid)).not.toThrow();
  expect(() => result.current.assertCurrent(company.uuid, 'owner')).toThrow();
});

it.each([false, true])(
  'keeps retained current owner business reads without administration: owned only %s',
  async (ownedOnly) => {
    const owned = companyRecord({
      status: 'active',
      email: null,
      primaryContact: null,
      documents: [],
      administrativeAccess: { capabilities: [], draftSetup: false },
    });
    api.get.mockImplementation(async (url) => (url === '/api/v1/companies/' ? page([owned]) : { data: owned }));
    const { result } = renderHook(() => useCompany({ ownedOnly }), { wrapper });
    await waitFor(() => expect(result.current.company?.uuid).toBe(owned.uuid));
    expect(result.current.ownerBusiness).toBe(true);
    expect(result.current.canAdmin).toBe(false);
    expect(result.current.company?.documents).toEqual([]);
    expect(result.current.company?.primaryContact).toBeNull();
    const held = result.current.requestConfig(owned.uuid, 'owner').ledovaSubmissionGuard!;
    expect(held).not.toThrow();
    expect(() => result.current.assertCurrent(owned.uuid)).toThrow();
    act(() => client.setQueryData(result.current.companyKey, { ...owned, isOwner: false }));
    expect(held).toThrow();
    await waitFor(() => expect(result.current.ownerBusiness).toBe(false));
    act(() => client.setQueryData(result.current.companyKey, owned));
    await waitFor(() => expect(result.current.ownerBusiness).toBe(true));
    act(() => prepareCompanyClient(client, 'investor'));
    expect(held).toThrow();
    await waitFor(() => expect(result.current.company).toBeNull());
    expect(result.current.companies).toEqual([]);
  },
);

it.each(['prepare', 'approve', 'apply', 'finance', 'read_register', 'revoked-owner', 'delegatable-admin', 'staff'])(
  'does not infer administration from %s',
  async (kind) => {
    if (kind === 'revoked-owner') prepareCompanyClient(client, 'investor');
    const row = {
      ...company,
      status: 'active',
      isOwner: kind === 'revoked-owner',
      administrativeAccess: {
        draftSetup: false,
        capabilities: ['prepare', 'approve', 'apply', 'finance', 'read_register'].includes(kind) ? [kind] : [],
      },
      delegatableCapabilities: ['admin'],
      isStaff: kind === 'staff',
    };
    api.get.mockResolvedValue(page([row]));
    const { result } = renderHook(() => useCompany(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.company).toBeNull();
    expect(result.current.canAdmin).toBe(false);
    expect(api.get.mock.calls).toHaveLength(1);
  },
);

it.each([true, false])('permits only the explicit draft setup allowance: %s', async (draftSetup) => {
  const draft = companyRecord({ administrativeAccess: { capabilities: [], draftSetup } });
  api.get.mockImplementation(async (url) => (url === '/api/v1/companies/' ? page([draft]) : { data: draft }));
  const { result } = renderHook(() => useCompany(), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.canAdmin).toBe(draftSetup);
});

it('invalidates a held dispatch guard immediately when the selected company changes', async () => {
  const other = companyRecord({ uuid: 'company-two' });
  api.get.mockImplementation(async (url) =>
    url === '/api/v1/companies/' ? page([company, other]) : { data: url.endsWith('company-two/') ? other : company },
  );
  const { result } = renderHook(() => useCompany(), { wrapper });
  await waitFor(() => expect(result.current.companies).toHaveLength(2));
  await act(async () => result.current.selectCompany(company.uuid));
  await waitFor(() => expect(result.current.canAdmin).toBe(true));
  const held = result.current.requestConfig(company.uuid).ledovaSubmissionGuard!;
  act(() => {
    result.current.selectCompany(other.uuid);
    expect(held).toThrow();
  });
});

it('refuses a held account guard and discards delayed detail after an account switch', async () => {
  let resolve: (value: unknown) => void = () => {};
  api.get.mockImplementation(async (url) =>
    url === '/api/v1/companies/'
      ? page([company])
      : new Promise((done) => {
          resolve = done;
        }),
  );
  const { result } = renderHook(() => useCompany(), { wrapper });
  await waitFor(() => expect(api.get.mock.calls).toHaveLength(2));
  const held = api.get.mock.calls[1][1].ledovaSubmissionGuard;
  act(() =>
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: 'profile-two', userAccount: { uuid: 'account-two', role: 'investor' } },
    }),
  );
  expect(held).toThrow();
  await act(async () => resolve({ data: { ...company, name: 'Stale foreign account detail' } }));
  expect(result.current.company?.name).not.toBe('Stale foreign account detail');
});

it('retires a held same-account guard through sign-out and reauthentication and through unmount', async () => {
  api.get.mockImplementation(async (url) => (url === '/api/v1/companies/' ? page([company]) : { data: company }));
  const { result, unmount } = renderHook(() => useCompany(), { wrapper });
  await waitFor(() => expect(result.current.canAdmin).toBe(true));
  const held = result.current.requestConfig(company.uuid).ledovaSubmissionGuard!;
  act(() => client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } }));
  act(() => client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } }));
  expect(held).toThrow();
  await waitFor(() => expect(result.current.canAdmin).toBe(true));
  const current = result.current.requestConfig(company.uuid).ledovaSubmissionGuard!;
  unmount();
  expect(current).toThrow();
});

it('checks current cached personal authority at dispatch and never chooses another company after loss', async () => {
  const other = companyRecord({ uuid: 'company-two' });
  let rows = [company, other];
  api.get.mockImplementation(async (url) => (url === '/api/v1/companies/' ? page(rows) : { data: company }));
  const { result } = renderHook(() => useCompany(), { wrapper });
  await waitFor(() => expect(result.current.companies).toHaveLength(2));
  await act(async () => result.current.selectCompany(company.uuid));
  await waitFor(() => expect(result.current.canAdmin).toBe(true));
  const held = result.current.requestConfig(company.uuid).ledovaSubmissionGuard!;
  act(() =>
    client.setQueryData(result.current.companyKey, {
      ...company,
      administrativeAccess: { capabilities: [], draftSetup: false },
    }),
  );
  expect(held).toThrow();
  rows = [other];
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.companies).toHaveLength(1));
  expect(result.current.company).toBeNull();
  expect(result.current.companyUuid).toBeUndefined();
  expect(result.current.companies).toHaveLength(1);
});

it.each(['company', 'document'])('rejects a foreign %s detail receipt', async (kind) => {
  const receipt =
    kind === 'company'
      ? { ...company, uuid: 'foreign-company' }
      : { ...company, documents: [{ uuid: 'foreign-document', company: 'foreign-company' }] };
  api.get.mockImplementation(async (url) => (url === '/api/v1/companies/' ? page([company]) : { data: receipt }));
  const { result } = renderHook(() => useCompany(), { wrapper });
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.company).toBeNull();
});

it.each(['admin', 'owner'] as const)('refuses list-only %s loss while the detail remains cached', async (mode) => {
  const initial: typeof company = {
    ...company,
    primaryContact: { fullName: 'Private owner contact' },
    documents: [
      {
        uuid: 'private-doc',
        company: company.uuid,
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
  api.get.mockImplementation(async (url) => ({
    data: url === '/api/v1/companies/' ? { results: [listed], next: null } : initial,
  }));
  const { result } = renderHook(() => useCompany(), { wrapper });
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
  expect(api.get.mock.calls.filter(([url]) => url !== '/api/v1/companies/')).toHaveLength(1);
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

it('keeps basic draft setup separate from activation and redacts a cached declaration after personal capability loss', async () => {
  const initial = companyRecord({
    activation: {
      appointment: '80000000-0000-4000-8000-000000000001',
      lifecycleRevision: 2,
      declarationVersion: '2026-10-04',
      declarationText: 'Private activation declaration',
      latestAttempt: null,
    },
  });
  api.get.mockImplementation(async (url) => ({
    data: url === '/api/v1/companies/' ? { results: [initial], next: null } : initial,
  }));
  const { result } = renderHook(() => useCompany(), { wrapper });
  await waitFor(() => expect(result.current.canPersonalAdmin).toBe(true));
  const held = result.current.requestConfig(initial.uuid, 'personal').ledovaSubmissionGuard!;
  act(() =>
    client.setQueryData(result.current.companiesKey, [
      { ...initial, administrativeAccess: { capabilities: [], draftSetup: true } },
    ]),
  );
  await waitFor(() => expect(result.current.canAdmin).toBe(true));
  expect(held).toThrow();
  await waitFor(() => expect(result.current.canPersonalAdmin).toBe(false));
  expect(result.current.company?.activation).toBeNull();
  expect(result.current.retainedCompany?.activation).toBeNull();
  expect(client.getQueryData(result.current.companyKey)).toEqual(initial);
});

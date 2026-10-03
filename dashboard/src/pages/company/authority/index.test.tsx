// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { ApiClientProvider, AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { PageTitle } from '@components/PageTitle';
import CompanyAuthorityPage from './index';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const providedApi = Object.assign(axios.create(), api);
const endpoint = '/api/v1/company-authority/requests/';
const companyA = { uuid: 'company-a', name: 'Harbour Synthetic Pty Ltd', acn: '000000019', status: 'draft' };
const companyB = { uuid: 'company-b', name: 'Inland Synthetic Pty Ltd', acn: '000000027', status: 'draft' };
const ownerA = { userProfile: 'profile-a', userAccount: { uuid: 'account-a' } };
const ownerB = { userProfile: 'profile-b', userAccount: { uuid: 'account-b' } };
const pendingMessage =
  'Evidence received and awaiting independent verification. Company authority verification is unavailable; this request grants no company authority.';
const withdrawnMessage =
  'Request withdrawn. Its evidence and original terms remain retained and accessible; company authority verification is unavailable, and this request grants no company authority.';
let client: QueryClient;
let rows: ReturnType<typeof request>[];

function request(company = companyA, uuid = 'request-a') {
  return {
    uuid,
    company: company.uuid,
    status: 'pending',
    verificationStatus: 'unavailable',
    verificationMessage: pendingMessage,
    companyIdentityRaw: { name: company.name, acn: company.acn },
    requestedCapabilities: ['prepare'],
    delegatableCapabilities: ['approve'],
    createdAt: '2026-10-03T01:00:00Z',
    withdrawnAt: null as string | null,
    originalFilename: 'authority.pdf',
    mimeType: 'application/pdf',
    fileUrl: 'https://foreign.example.test/private-file',
  };
}

function page(results: unknown[], next: string | null = null) {
  return { data: { results, next, count: results.length, previous: null } };
}

function withdrawn() {
  return {
    ...request(),
    status: 'withdrawn',
    withdrawnAt: '2026-10-03T02:00:00Z',
    verificationMessage: withdrawnMessage,
  };
}

function show() {
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={providedApi}>
        <PageTitle.Provider value="Representative authority">
          <CompanyAuthorityPage />
        </PageTitle.Provider>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

async function fill(company = companyA) {
  fireEvent.change(await screen.findByLabelText('Draft company'), { target: { value: company.uuid } });
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Actions you request permission to delegate' })).getByRole('checkbox', {
      name: 'Approve register changes',
    }),
  );
  const file = new File(['%PDF synthetic representative evidence'], 'authority.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Representative evidence'), { target: { files: [file] } });
  return file;
}

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: ownerA });
  rows = [];
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/v1/companies/') return page([companyA, companyB]);
    if (url === endpoint) return page(rows);
    throw new Error(`Unexpected read ${url}`);
  });
  api.post.mockImplementation(async (_url: string, form: FormData) => {
    const result = request(form.get('company') === companyB.uuid ? companyB : companyA);
    rows = [result];
    return { data: result };
  });
  URL.createObjectURL = vi.fn(() => 'blob:private-authority');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('loads every owned-company page and requires explicit draft selection', async () => {
  api.get.mockImplementation(async (url: string, config: { params?: { page?: number } }) => {
    if (url === endpoint) return page([]);
    return config.params?.page === 2
      ? page([companyB])
      : page(
          [companyA, { ...companyA, uuid: 'active-company', name: 'Active Synthetic', status: 'active' }],
          'http://localhost/api/v1/companies/?page=2',
        );
  });
  show();
  expect(await screen.findByRole('option', { name: /Inland Synthetic/ })).toBeTruthy();
  expect(screen.queryByRole('option', { name: /Active Synthetic/ })).toBeNull();
  expect((screen.getByLabelText('Draft company') as HTMLSelectElement).value).toBe('');
  expect(screen.queryByLabelText('Representative evidence')).toBeNull();
  expect(api.get).toHaveBeenCalledWith('/api/v1/companies/', {
    params: { page: 2 },
    ledovaSubmissionGuard: expect.any(Function),
  });
});

it('records independently requested delegation as pending with no authority grant', async () => {
  show();
  const file = await fill(companyB);
  fireEvent.click(screen.getByRole('button', { name: 'Submit authority request' }));
  expect(await screen.findByText(/Request recorded: request-a/)).toBeTruthy();
  expect(screen.getByText('Pending verification')).toBeTruthy();
  expect(screen.getAllByText(pendingMessage).length).toBeGreaterThan(0);
  const [url, form, config] = api.post.mock.calls[0];
  expect(url).toBe(endpoint);
  expect(form.get('company')).toBe(companyB.uuid);
  expect(form.get('file')).toBe(file);
  expect(form.getAll('requested_capabilities')).toEqual([]);
  expect(form.getAll('delegatable_capabilities')).toEqual(['approve']);
  expect([...form.keys()]).toEqual(['company', 'idempotency_key', 'file', 'delegatable_capabilities']);
  expect(config.ledovaSubmissionGuard).toBeTypeOf('function');
  expect(screen.queryByRole('button', { name: /approve request|grant authority|accept mandate/i })).toBeNull();
});

it('retries the same failed submission using the same file and idempotency key', async () => {
  api.post.mockRejectedValueOnce(new Error('Synthetic unavailable request service'));
  show();
  const file = await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Submit authority request' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Submit authority request' }));
  await screen.findByText(/Request recorded/);
  const first = api.post.mock.calls[0][1] as FormData;
  const second = api.post.mock.calls[1][1] as FormData;
  expect(first.get('idempotency_key')).toBe(second.get('idempotency_key'));
  expect(first.get('file')).toBe(file);
  expect(second.get('file')).toBe(file);
});

it('uses a new key when requested terms change after a refusal', async () => {
  api.post.mockRejectedValueOnce(new Error('Synthetic refusal'));
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Submit authority request' }));
  await screen.findByRole('alert');
  fireEvent.change(screen.getByLabelText('Requested expiry date (UTC, optional)'), { target: { value: '2027-12-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit authority request' }));
  await screen.findByText(/Request recorded/);
  const first = api.post.mock.calls[0][1] as FormData;
  const second = api.post.mock.calls[1][1] as FormData;
  expect(first.get('idempotency_key')).not.toBe(second.get('idempotency_key'));
  expect(second.get('requested_expires_at')).toBe('2027-12-31T23:59:59Z');
});

it('retires the previous company file and scope when selection changes', async () => {
  show();
  await fill();
  fireEvent.change(screen.getByLabelText('Draft company'), { target: { value: companyB.uuid } });
  expect((screen.getByLabelText('Representative evidence') as HTMLInputElement).value).toBe('');
  expect(screen.getAllByRole('checkbox').every((checkbox) => !(checkbox as HTMLInputElement).checked)).toBe(true);
  expect((screen.getByRole('button', { name: 'Submit authority request' }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.post).not.toHaveBeenCalled();
});

it('does not apply a delayed submission result to the next selected company', async () => {
  let finish!: (value: unknown) => void;
  api.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show();
  await fill();
  fireEvent.click(screen.getByRole('button', { name: 'Submit authority request' }));
  await screen.findByRole('button', { name: 'Submitting…' });
  fireEvent.change(screen.getByLabelText('Draft company'), { target: { value: companyB.uuid } });
  await act(async () => finish({ data: request() }));
  expect(screen.queryByText(/Request recorded/)).toBeNull();
  expect((screen.getByLabelText('Draft company') as HTMLSelectElement).value).toBe(companyB.uuid);
  expect((screen.getByRole('button', { name: 'Submit authority request' }) as HTMLButtonElement).disabled).toBe(true);
});

it('does not load private request history without a current authenticated account', async () => {
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
  show();
  expect(screen.getByText('Verify your signed-in account before opening representative authority.')).toBeTruthy();
  expect(api.get).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Your request history' })).toBeNull();
});

it('shows frozen company identity and downloads private evidence through the authenticated request route', async () => {
  rows = [request()];
  api.get.mockImplementation(async (url: string) => {
    if (url === endpoint) return page(rows);
    if (url.endsWith('/file/')) return { data: new Uint8Array([1, 2]).buffer };
    return page([{ ...companyA, name: 'Changed company display name' }]);
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  show();
  expect(await screen.findByText(`${companyA.name} · ${companyA.acn}`)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Download evidence authority.pdf' }));
  await waitFor(() => expect(click).toHaveBeenCalled());
  expect(api.get).toHaveBeenCalledWith(`${endpoint}request-a/file/`, {
    responseType: 'arraybuffer',
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  expect(api.get).not.toHaveBeenCalledWith('https://foreign.example.test/private-file', expect.anything());
});

it('suppresses cached private history after a failed refresh and retries it', async () => {
  rows = [request()];
  show();
  await screen.findByRole('button', { name: 'Download evidence authority.pdf' });
  api.get.mockRejectedValueOnce(new Error('Synthetic unavailable history'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['company-authority-requests'] });
  });
  expect(await screen.findByText('Your authority requests could not be loaded.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Download evidence authority.pdf' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry request history' }));
  expect(await screen.findByRole('button', { name: 'Download evidence authority.pdf' })).toBeTruthy();
});

it('cannot display the former account history when the authenticated account changes', async () => {
  rows = [request()];
  show();
  await screen.findByRole('button', { name: 'Download evidence authority.pdf' });
  rows = [];
  await act(async () => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: ownerB });
  });
  await screen.findByText('No authority requests recorded.');
  expect(screen.queryByText('request-a')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download evidence authority.pdf' })).toBeNull();
});

it('rejects delayed private file delivery after an account switch', async () => {
  rows = [request()];
  let finish!: (value: unknown) => void;
  api.get.mockImplementation(async (url: string) => {
    if (url === endpoint) return page(rows);
    if (url.endsWith('/file/'))
      return new Promise((resolve) => {
        finish = resolve;
      });
    return page([companyA]);
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Download evidence authority.pdf' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  rows = [];
  await act(async () => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: ownerB });
  });
  await act(async () => finish({ data: new Uint8Array([1]).buffer }));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(await screen.findByText('No authority requests recorded.')).toBeTruthy();
});

it('withdraws a pending request, shows the server time and retains evidence access', async () => {
  rows = [request()];
  api.post.mockResolvedValueOnce({ data: withdrawn() });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Withdraw request authority.pdf' }));
  await waitFor(() => expect(screen.queryByText('Pending verification')).toBeNull());
  expect(screen.getAllByText('Withdrawn').length).toBeGreaterThan(0);
  expect(screen.getByText(withdrawn().verificationMessage)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Download evidence authority.pdf' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Withdraw request authority.pdf' })).toBeNull();
  expect(api.post).toHaveBeenCalledWith(
    `${endpoint}request-a/withdraw/`,
    {},
    {
      ledovaSubmissionGuard: expect.any(Function),
    },
  );
  expect(client.getQueryData(['company-authority-requests', 'profile-a', 'account-a'])).toEqual([withdrawn()]);
});

it('retries an uncertain withdrawal against the same request without optimistic success', async () => {
  rows = [request()];
  api.post
    .mockRejectedValueOnce(new Error('Synthetic interrupted withdrawal'))
    .mockResolvedValueOnce({ data: withdrawn() });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Withdraw request authority.pdf' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Pending verification')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw request authority.pdf' }));
  await screen.findByText(withdrawn().verificationMessage);
  expect(api.post.mock.calls.map(([url, body]) => [url, body])).toEqual([
    [`${endpoint}request-a/withdraw/`, {}],
    [`${endpoint}request-a/withdraw/`, {}],
  ]);
});

it('renders a retained withdrawn request with no withdrawal action', async () => {
  rows = [withdrawn()];
  show();
  await screen.findByText(withdrawn().verificationMessage);
  expect(screen.queryByText('Pending verification')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Withdraw request authority.pdf' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Download evidence authority.pdf' })).toBeTruthy();
});

it('does not restore a pending state from a stale read after confirmed withdrawal', async () => {
  rows = [request()];
  let finishPost!: (value: unknown) => void;
  let finishRead!: (value: unknown) => void;
  api.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishPost = resolve;
      }),
  );
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Withdraw request authority.pdf' }));
  await waitFor(() => expect(finishPost).toBeTypeOf('function'));
  api.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  );
  let refreshing!: Promise<void>;
  await act(async () => {
    refreshing = client.invalidateQueries({ queryKey: ['company-authority-requests'] });
  });
  await waitFor(() => expect(finishRead).toBeTypeOf('function'));
  await act(async () => finishPost({ data: withdrawn() }));
  await screen.findByText(withdrawn().verificationMessage);
  await act(async () => {
    finishRead(page([request()]));
    await refreshing;
  });
  await waitFor(() => {
    expect(client.getQueryState(['company-authority-requests', 'profile-a', 'account-a'])?.fetchStatus).toBe('idle');
    expect(client.getQueryData(['company-authority-requests', 'profile-a', 'account-a'])).toEqual([withdrawn()]);
  });
  expect(screen.queryByText('Pending verification')).toBeNull();
  expect(screen.getByText(withdrawn().verificationMessage)).toBeTruthy();
});

it('ignores a delayed withdrawal result after an account switch', async () => {
  rows = [request()];
  let finish!: (value: unknown) => void;
  api.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Withdraw request authority.pdf' }));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  rows = [];
  await act(async () => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: ownerB });
  });
  await screen.findByText('No authority requests recorded.');
  await act(async () => finish({ data: withdrawn() }));
  expect(screen.queryByText(withdrawn().verificationMessage)).toBeNull();
  expect(screen.getByText('No authority requests recorded.')).toBeTruthy();
  expect(client.getQueryData(['company-authority-requests', 'profile-b', 'account-b'])).toEqual([]);
});

it('keeps a refused history hidden after a delayed withdrawal receipt until an explicit successful read', async () => {
  rows = [request(), request(companyB, 'request-b')];
  let finish!: (value: unknown) => void;
  api.post.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show();
  const actions = await screen.findAllByRole('button', { name: 'Withdraw request authority.pdf' });
  fireEvent.click(actions[0]);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  api.get.mockRejectedValueOnce(new Error('Synthetic refused history'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['company-authority-requests'] });
  });
  await screen.findByText('Your authority requests could not be loaded.');
  rows = [withdrawn(), request(companyB, 'request-b')];
  await act(async () => finish({ data: withdrawn() }));
  expect(screen.getByText('Your authority requests could not be loaded.')).toBeTruthy();
  expect(screen.queryByText('request-b')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download evidence authority.pdf' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry request history' }));
  await screen.findByText(withdrawn().verificationMessage);
  expect(screen.getByText('request-b')).toBeTruthy();
});

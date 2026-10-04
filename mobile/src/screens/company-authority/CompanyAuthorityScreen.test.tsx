import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { COMPANY_AUTHORITY_DECLARATION, COMPANY_AUTHORITY_DECLARATION_VERSION, formatDateTime } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { files, pickedFile, resetFiles } from '../../testSupport/documentFiles';
import { CompanyAuthorityScreen } from './CompanyAuthorityScreen';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('../../services/tokenStorage', () => ({ getAccessToken: jest.fn(async () => 'synthetic-access') }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

const COMPANIES = '/api/v1/companies/';
const REQUESTS = '/api/v1/company-authority/requests/';
const a = { uuid: 'company-a', name: 'Draft A', acn: '000000019', status: 'draft' };
const b = { uuid: 'company-b', name: 'Draft B', acn: '000000027', status: 'draft' };
const pendingMessage =
  'Evidence retained. Accept the company authorisation declaration to establish initial authority after the required identity and ABR company checks pass. This pending request grants no company authority.';
const withdrawnMessage =
  'Request withdrawn. Its evidence and original terms remain retained and accessible; this request grants no company authority. Submit a new request to declare company authorisation.';
const record = {
  uuid: 'request-a',
  company: a.uuid,
  companyIdentityRaw: { name: 'Frozen Company A', acn: a.acn, abn: '', companyType: 'proprietary' },
  originalFilename: 'retained.pdf',
  createdAt: '2026-10-03T00:00:00Z',
  status: 'pending',
  withdrawnAt: null as string | null,
  verificationStatus: 'unavailable',
  verificationMessage: pendingMessage,
  requestedCapabilities: ['prepare'],
  delegatableCapabilities: ['approve'],
  requestedExpiresAt: null,
  fileSha256: 'a'.repeat(64),
};
const withdrawn = {
  ...record,
  status: 'withdrawn',
  withdrawnAt: '2026-10-03T02:15:00Z',
  verificationMessage: withdrawnMessage,
};
const admissionRequest = { ...record, requestedCapabilities: ['admin', 'prepare'] };
const admitted = {
  ...admissionRequest,
  status: 'admitted',
  verificationStatus: 'self_declared',
  verificationMessage: 'Your self-declaration and company appointment have been recorded.',
  appointment: {
    uuid: 'appointment-a',
    capabilities: ['admin', 'prepare'],
    delegatableCapabilities: ['approve'],
    createdAt: '2026-10-04T01:00:00Z',
    expiresAt: '2027-01-31T23:59:59Z',
    revokedAt: null as string | null,
    status: 'active',
    isEffective: true,
    declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION,
    declarationText: COMPANY_AUTHORITY_DECLARATION,
  },
};
const revoked = {
  ...admitted,
  appointment: { ...admitted.appointment, status: 'revoked', isEffective: false, revokedAt: '2026-10-04T02:00:00Z' },
};
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const pick = jest.mocked(DocumentPicker.getDocumentAsync);
let client: QueryClient;
let history: (typeof record)[];
let companyReadFailure: boolean;
let historyReadFailure: boolean;
let nextKey: number;
let append: jest.SpyInstance<ReturnType<FormData['append']>, Parameters<FormData['append']>>;
const pendingResponses: (() => void)[] = [];

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function parts(form: unknown) {
  return append.mock.calls
    .filter((_, index) => append.mock.contexts[index] === form)
    .map(([name, value]) => [name, value] as [string, unknown]);
}

function field(form: unknown, key: string) {
  return parts(form).find(([name]) => name === key)?.[1];
}

function deferred<T>(fallback: T) {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  pendingResponses.push(() => resolve(fallback));
  return { promise, resolve, reject };
}

beforeEach(() => {
  append = jest.spyOn(FormData.prototype, 'append');
  resetFiles();
  history = [];
  companyReadFailure = false;
  historyReadFailure = false;
  nextKey = 0;
  jest
    .mocked(Crypto.randomUUID)
    .mockImplementation(() => `00000000-0000-4000-8000-${String(++nextKey).padStart(12, '0')}`);
  pick.mockReset().mockImplementation(async () => pickedFile());
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue();
  post.mockReset().mockResolvedValue({ data: record });
  get.mockReset().mockImplementation(async (url, config) => {
    const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
    if (url === COMPANIES) {
      if (companyReadFailure) throw new Error('Company read refused');
      return {
        data: {
          results: page === 1 ? [{ uuid: 'active', name: 'Active Company', status: 'active' }] : [a, b],
          next: page === 1 ? 'https://api.example.test/companies/?page=2' : null,
          count: 3,
        },
      };
    }
    if (url === REQUESTS) {
      if (historyReadFailure) throw new Error('History read refused');
      return { data: { results: history, count: history.length, next: null } };
    }
    if (url === `${REQUESTS}${record.uuid}/file/`)
      return { data: new Uint8Array([65, 66]).buffer, headers: { 'content-type': 'application/pdf' } };
    throw new Error(`Unexpected request: ${url}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});

afterEach(async () => {
  await cleanup();
  await act(() => pendingResponses.splice(0).forEach((settle) => settle()));
  client.clear();
});

async function selectAndPick(view: Awaited<ReturnType<typeof render>>, company = 'Draft B') {
  await fireEvent.press(await view.findByRole('radio', { name: company }));
  await fireEvent.press(view.getByRole('button', { name: 'Choose evidence' }));
  await view.findByRole('button', { name: 'Replace evidence' });
}

it('reads every owned-company page, requires explicit selection and submits separate permission scopes', async () => {
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  expect(await view.findByText('Select a company to prepare your request.')).toBeTruthy();
  expect(view.queryByRole('radio', { name: 'Active Company' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Choose evidence' })).toBeNull();
  expect(get).toHaveBeenCalledWith(COMPANIES, { params: { page: 2 }, ledovaSessionEpoch: getSessionEpoch() });
  await selectAndPick(view);
  await fireEvent.press(view.getByRole('button', { name: 'Permissions you would exercise: Prepare register changes' }));
  await fireEvent.press(view.getByRole('button', { name: 'Permissions you would delegate: Approve register changes' }));
  const epoch = getSessionEpoch();
  await fireEvent.press(view.getByRole('button', { name: 'Submit authority request' }));
  expect(await view.findByText(`Your request has been retained. ${pendingMessage}`)).toBeTruthy();
  const body = post.mock.calls[0][1];
  expect(field(body, 'company')).toBe(b.uuid);
  expect(parts(body)).toEqual(
    expect.arrayContaining([
      ['requested_capabilities', 'prepare'],
      ['delegatable_capabilities', 'approve'],
    ]),
  );
  expect(field(body, 'file')).toEqual(expect.objectContaining({ name: '1.pdf', type: 'application/pdf' }));
  expect(parts(body).some(([name]) => /verified|representative|requester|provider|status/.test(name))).toBe(false);
  expect(post.mock.calls[0][2]).toEqual(expect.objectContaining({ ledovaSessionEpoch: epoch }));
  expect([...files.keys()].some((uri) => uri.includes('ledova-upload-copies'))).toBe(false);
});

it('allows delegation-only evidence and an optional expiry without inventing exercised permissions', async () => {
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await selectAndPick(view);
  await fireEvent.press(view.getByRole('button', { name: 'Permissions you would exercise: Manage company team' }));
  expect(view.getByRole('button', { name: 'Submit authority request' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Permissions you would delegate: Read company register' }));
  await fireEvent.press(view.getByRole('button', { name: 'Choose expiry date' }));
  await fireEvent(view.getByTestId('authority-expiry'), 'onChange', { type: 'set' }, new Date('2099-01-01T00:00:00Z'));
  await fireEvent.press(view.getByRole('button', { name: 'Submit authority request' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(parts(post.mock.calls[0][1]).filter(([name]) => name === 'requested_capabilities')).toEqual([]);
  expect(field(post.mock.calls[0][1], 'delegatable_capabilities')).toBe('read_register');
  expect(field(post.mock.calls[0][1], 'requested_expires_at')).toBe('2099-01-01T00:00:00.000Z');
});

it('keeps exact evidence and idempotency key through an interrupted response, then rotates the key for changed terms', async () => {
  post.mockRejectedValue({ response: { data: { detail: 'Response interrupted' } } });
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await selectAndPick(view);
  await fireEvent.press(view.getByRole('button', { name: 'Permissions you would exercise: Prepare register changes' }));
  await fireEvent.press(view.getByRole('button', { name: 'Submit authority request' }));
  await view.findByText('Response interrupted');
  const first = post.mock.calls[0][1];
  const uri = (field(first, 'file') as { uri: string }).uri;
  expect(files.has(uri)).toBe(true);
  await fireEvent.press(view.getByRole('button', { name: 'Submit authority request' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(parts(post.mock.calls[1][1])).toEqual(parts(first));
  await fireEvent.press(view.getByRole('button', { name: 'Permissions you would delegate: Approve register changes' }));
  post.mockResolvedValue({ data: record });
  await fireEvent.press(view.getByRole('button', { name: 'Submit authority request' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
  expect(field(post.mock.calls[2][1], 'idempotency_key')).not.toEqual(field(first, 'idempotency_key'));
  expect(field(post.mock.calls[2][1], 'file')).toEqual(field(first, 'file'));
  expect(files.has(uri)).toBe(false);
});

it('retires evidence when the selected company changes and never submits it for the new company', async () => {
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await selectAndPick(view);
  await fireEvent.press(view.getByRole('button', { name: 'Permissions you would exercise: Prepare register changes' }));
  const uri = [...files.keys()].find((value) => value.includes('ledova-upload-copies'))!;
  await fireEvent.press(view.getByRole('radio', { name: 'Draft A' }));
  expect(view.getByRole('button', { name: 'Choose evidence' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Submit authority request' })).toBeDisabled();
  expect(files.has(uri)).toBe(false);
  expect(post).not.toHaveBeenCalled();
});

it('retains the draft but blocks a cached company after refresh fails and recovers through retry', async () => {
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await selectAndPick(view);
  await fireEvent.press(view.getByRole('button', { name: 'Permissions you would exercise: Prepare register changes' }));
  companyReadFailure = true;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh' }));
  await view.findByText('Your companies could not be loaded. Retry before submitting.');
  expect(view.getByRole('button', { name: 'Submit authority request' })).toBeDisabled();
  expect(view.getByText('1.pdf')).toBeTruthy();
  companyReadFailure = false;
  await fireEvent.press(view.getByRole('button', { name: 'Retry companies' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Submit authority request' })).toBeEnabled());
  expect(post).not.toHaveBeenCalled();
});

it('reads every own-history page and displays frozen identity, pending status and retained evidence', async () => {
  const previous = get.getMockImplementation()!;
  get.mockImplementation(async (url, config) => {
    if (url !== REQUESTS) return previous(url, config);
    const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
    return {
      data: {
        results: page === 1 ? [] : [record],
        next: page === 1 ? 'https://api.example.test/requests/?page=2' : null,
        count: 1,
      },
    };
  });
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  expect(await view.findByText('Frozen Company A')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Request retained.pdf' }));
  expect(view.getByText(a.acn)).toBeTruthy();
  expect(view.getByText(pendingMessage)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'View retained evidence' }));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  expect(get).toHaveBeenCalledWith(`${REQUESTS}${record.uuid}/file/`, {
    responseType: 'arraybuffer',
    ledovaSessionEpoch: getSessionEpoch(),
  });
  expect(view.queryByRole('button', { name: /approve request|activate company|delete request/i })).toBeNull();
});

it('hides cached history and exposes a retry after a refused history refresh', async () => {
  history = [record];
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await view.findByText('Frozen Company A');
  historyReadFailure = true;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh' }));
  await view.findByText('Your requests could not be loaded.');
  expect(view.queryByText('Frozen Company A')).toBeNull();
  historyReadFailure = false;
  await fireEvent.press(view.getByRole('button', { name: 'Retry requests' }));
  expect(await view.findByText('Frozen Company A')).toBeTruthy();
});

it('clears private history and selected evidence as soon as the authenticated session changes', async () => {
  history = [record];
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await view.findByText('Frozen Company A');
  await selectAndPick(view);
  const uri = [...files.keys()].find((value) => value.includes('ledova-upload-copies'))!;
  history = [];
  await act(() => invalidateSessionScope());
  expect(view.queryByText('Frozen Company A')).toBeNull();
  expect(view.queryByText('1.pdf')).toBeNull();
  expect(files.has(uri)).toBe(false);
  expect(await view.findByText('Select a company to prepare your request.')).toBeTruthy();
});

it('suppresses a previous session submission result and retains active upload bytes until it settles', async () => {
  const response = deferred({ data: record });
  post.mockReturnValue(response.promise);
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await selectAndPick(view);
  await fireEvent.press(view.getByRole('button', { name: 'Permissions you would exercise: Prepare register changes' }));
  await fireEvent.press(view.getByRole('button', { name: 'Submit authority request' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const uri = (field(post.mock.calls[0][1], 'file') as { uri: string }).uri;
  await act(() => invalidateSessionScope());
  expect(files.has(uri)).toBe(true);
  await act(() => response.resolve({ data: record }));
  await waitFor(() => expect(files.has(uri)).toBe(false));
  expect(view.queryByText(`Your request has been retained. ${pendingMessage}`)).toBeNull();
});

it('does not share a private download that completes after sign-out', async () => {
  history = [record];
  const response = deferred({ data: new ArrayBuffer(2), headers: { 'content-type': 'application/pdf' } });
  const previous = get.getMockImplementation()!;
  get.mockImplementation((url, config) =>
    url === `${REQUESTS}${record.uuid}/file/` ? response.promise : previous(url, config),
  );
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  await fireEvent.press(view.getByRole('button', { name: 'View retained evidence' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith(`${REQUESTS}${record.uuid}/file/`, expect.any(Object)));
  history = [];
  await act(() => invalidateSessionScope());
  await act(() => response.resolve({ data: new ArrayBuffer(2), headers: { 'content-type': 'application/pdf' } }));
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect([...files.keys()].some((uri) => uri.includes('ledova-document-views'))).toBe(false);
});

it('withdraws only after the server confirms it and retains access to the original evidence', async () => {
  history = [record];
  const response = deferred({ data: withdrawn });
  post.mockReturnValue(response.promise);
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  const epoch = getSessionEpoch();
  await fireEvent.press(view.getByRole('button', { name: 'Withdraw request' }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(`${REQUESTS}${record.uuid}/withdraw/`, {}, { ledovaSessionEpoch: epoch }),
  );
  expect(view.getByText(`Pending · ${formatDateTime(record.createdAt)}`)).toBeTruthy();
  expect(view.getByRole('button', { name: 'Withdrawing…' })).toBeDisabled();
  expect(view.queryByText(withdrawn.verificationMessage)).toBeNull();
  await act(() => response.resolve({ data: withdrawn }));
  expect(await view.findByText(`Withdrawn · ${formatDateTime(withdrawn.withdrawnAt)}`)).toBeTruthy();
  expect(view.getByText(formatDateTime(withdrawn.withdrawnAt))).toBeTruthy();
  expect(view.getByText(withdrawn.verificationMessage)).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Withdraw request' })).toBeNull();
  expect(client.getQueryData(['company-authority-requests', epoch])).toEqual([withdrawn]);
  await fireEvent.press(view.getByRole('button', { name: 'View retained evidence' }));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  expect(view.queryByRole('button', { name: /approve request|activate company|delete request/i })).toBeNull();
});

it('shows a withdrawal refusal and retries the same request to receive its original withdrawal outcome', async () => {
  history = [record];
  post.mockRejectedValueOnce({ response: { data: { detail: 'Withdrawal response interrupted' } } });
  post.mockResolvedValue({ data: withdrawn });
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  await fireEvent.press(view.getByRole('button', { name: 'Withdraw request' }));
  expect(await view.findByText('Withdrawal response interrupted')).toBeTruthy();
  expect(view.getByText(`Pending · ${formatDateTime(record.createdAt)}`)).toBeTruthy();
  expect(view.getByRole('button', { name: 'Withdraw request' })).toBeEnabled();
  await fireEvent.press(view.getByRole('button', { name: 'Withdraw request' }));
  await view.findByText(withdrawn.verificationMessage);
  expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
  expect(view.queryByText('Withdrawal response interrupted')).toBeNull();
  expect(view.queryByRole('button', { name: 'Withdraw request' })).toBeNull();
});

it('offers retained evidence for an already withdrawn record without another withdrawal action', async () => {
  history = [withdrawn];
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  expect(view.getByText(`Withdrawn · ${formatDateTime(withdrawn.withdrawnAt)}`)).toBeTruthy();
  expect(view.getByText(formatDateTime(withdrawn.withdrawnAt))).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Withdraw request' })).toBeNull();
  expect(view.queryByText(pendingMessage)).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'View retained evidence' }));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  expect(post).not.toHaveBeenCalled();
});

it('reconciles an interrupted withdrawal through history without retaining its stale error', async () => {
  history = [record];
  post.mockRejectedValue({ response: { data: { detail: 'Withdrawal response interrupted' } } });
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  await fireEvent.press(view.getByRole('button', { name: 'Withdraw request' }));
  await view.findByText('Withdrawal response interrupted');
  history = [withdrawn];
  await fireEvent.press(view.getByRole('button', { name: 'Refresh' }));
  await view.findByText(withdrawn.verificationMessage);
  expect(view.queryByText('Withdrawal response interrupted')).toBeNull();
  expect(view.queryByRole('button', { name: 'Withdraw request' })).toBeNull();
});

it('shows the server withdrawal outcome when retrying the original evidence submission', async () => {
  history = [withdrawn];
  post.mockResolvedValue({ data: withdrawn });
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await selectAndPick(view);
  await fireEvent.press(view.getByRole('button', { name: 'Permissions you would exercise: Prepare register changes' }));
  await fireEvent.press(view.getByRole('button', { name: 'Submit authority request' }));
  expect(await view.findByText(`Your request has been retained. ${withdrawn.verificationMessage}`)).toBeTruthy();
  expect(view.queryByText(`Your request has been retained. ${pendingMessage}`)).toBeNull();
});

it('refuses an unconfirmed withdrawal response and keeps the pending request available to retry', async () => {
  history = [record];
  post.mockResolvedValue({ data: { ...withdrawn, uuid: 'another-request' } });
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  await fireEvent.press(view.getByRole('button', { name: 'Withdraw request' }));
  await view.findByText('The request outcome could not be confirmed. Retry the same request or refresh.');
  expect(view.getByRole('button', { name: 'Withdraw request' })).toBeEnabled();
  expect(client.getQueryData(['company-authority-requests', getSessionEpoch()])).toEqual([record]);
});

it('cancels a stale history read so it cannot restore pending after a confirmed withdrawal', async () => {
  history = [record];
  const response = deferred({ data: withdrawn });
  post.mockReturnValue(response.promise);
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  await fireEvent.press(view.getByRole('button', { name: 'Withdraw request' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const stale = deferred({ data: { results: [record], count: 1, next: null } });
  const previous = get.getMockImplementation()!;
  get.mockImplementation((url, config) => (url === REQUESTS ? stale.promise : previous(url, config)));
  await fireEvent.press(view.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(get.mock.calls.filter(([url]) => url === REQUESTS)).toHaveLength(2));
  const config = get.mock.calls.filter(([url]) => url === REQUESTS)[1][1];
  expect(config?.signal?.aborted).toBe(false);
  await act(() => response.resolve({ data: withdrawn }));
  await view.findByText(withdrawn.verificationMessage);
  expect(config?.signal?.aborted).toBe(true);
  await act(() => stale.resolve({ data: { results: [record], count: 1, next: null } }));
  await waitFor(() =>
    expect(client.getQueryState(['company-authority-requests', getSessionEpoch()])?.fetchStatus).toBe('idle'),
  );
  expect(view.getByText(`Withdrawn · ${formatDateTime(withdrawn.withdrawnAt)}`)).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Withdraw request' })).toBeNull();
  expect(client.getQueryData(['company-authority-requests', getSessionEpoch()])).toEqual([withdrawn]);
});

it('keeps refused history hidden when a withdrawal response arrives and recovers through an explicit retry', async () => {
  const other = {
    ...record,
    uuid: 'request-b',
    companyIdentityRaw: { ...record.companyIdentityRaw, name: 'Other private company' },
    originalFilename: 'other.pdf',
  };
  history = [record, other];
  const response = deferred({ data: withdrawn });
  post.mockReturnValue(response.promise);
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  await fireEvent.press(view.getByRole('button', { name: 'Withdraw request' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  historyReadFailure = true;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh' }));
  await view.findByText('Your requests could not be loaded.');
  await act(() => response.resolve({ data: withdrawn }));
  expect(client.getQueryState(['company-authority-requests', getSessionEpoch()])?.status).toBe('error');
  expect(view.getByText('Your requests could not be loaded.')).toBeTruthy();
  expect(view.queryByText('Frozen Company A')).toBeNull();
  expect(view.queryByText('Other private company')).toBeNull();
  historyReadFailure = false;
  history = [withdrawn, other];
  await fireEvent.press(view.getByRole('button', { name: 'Retry requests' }));
  expect(await view.findByText(`Withdrawn · ${formatDateTime(withdrawn.withdrawnAt)}`)).toBeTruthy();
  expect(view.getByText('Other private company')).toBeTruthy();
  expect(post).toHaveBeenCalledTimes(1);
});

it.each(['success', 'refusal'])('suppresses a previous session withdrawal %s', async (outcome) => {
  history = [record];
  const response = deferred({ data: withdrawn });
  post.mockReturnValue(response.promise);
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  await fireEvent.press(view.getByRole('button', { name: 'Withdraw request' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  history = [];
  await act(() => invalidateSessionScope());
  await view.findByText('You have not submitted an authority request.');
  await act(() => {
    if (outcome === 'success') response.resolve({ data: withdrawn });
    else response.reject({ response: { data: { detail: 'Earlier session withdrawal refused' } } });
  });
  expect(view.queryByText('Frozen Company A')).toBeNull();
  expect(view.queryByText(withdrawn.verificationMessage)).toBeNull();
  expect(view.queryByText('Earlier session withdrawal refused')).toBeNull();
  expect(client.getQueryData(['company-authority-requests', getSessionEpoch()])).toEqual([]);
});

it('cancels the previous session history transport and hides its late private records', async () => {
  const stale = deferred({ data: { results: [record], count: 1, next: null } });
  const previous = get.getMockImplementation()!;
  get.mockImplementation((url, config) => (url === REQUESTS ? stale.promise : previous(url, config)));
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await waitFor(() => expect(get).toHaveBeenCalledWith(REQUESTS, expect.any(Object)));
  const config = get.mock.calls.find(([url]) => url === REQUESTS)![1];
  get.mockImplementation(previous);
  await act(() => invalidateSessionScope());
  expect(await view.findByText('You have not submitted an authority request.')).toBeTruthy();
  expect(config?.signal?.aborted).toBe(true);
  await act(() => stale.resolve({ data: { results: [record], count: 1, next: null } }));
  expect(view.queryByText('Frozen Company A')).toBeNull();
  expect(client.getQueryData(['company-authority-requests', getSessionEpoch()])).toEqual([]);
});

it('requires declaration acceptance, records the appointment and revokes while retaining declaration and evidence', async () => {
  history = [admissionRequest];
  post.mockResolvedValueOnce({ data: admitted }).mockResolvedValueOnce({ data: revoked });
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  expect(view.getByRole('button', { name: 'Establish appointment' })).toBeDisabled();
  expect(view.getByText(COMPANY_AUTHORITY_DECLARATION)).toBeTruthy();
  expect(view.getByText('Company information (provided by the company)')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Establish appointment' }));
  expect(post).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('checkbox', { name: 'Accept authorisation declaration', checked: false }));
  await fireEvent.press(view.getByRole('button', { name: 'Establish appointment' }));
  await view.findByText('appointment-a');
  expect(post).toHaveBeenNthCalledWith(
    1,
    `${REQUESTS}request-a/admit/`,
    { declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION, acceptDeclaration: true },
    { ledovaSessionEpoch: getSessionEpoch() },
  );
  expect(view.getByText(`Admitted · ${formatDateTime(admitted.appointment.createdAt)}`)).toBeTruthy();
  expect(view.queryByText(/^Pending/)).toBeNull();
  expect(view.getByText('active')).toBeTruthy();
  expect(view.getByText('Current')).toBeTruthy();
  expect(view.getAllByText('Manage company team, Prepare register changes').length).toBeGreaterThan(0);
  expect(view.getByText(COMPANY_AUTHORITY_DECLARATION_VERSION)).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Withdraw request' })).toBeNull();
  expect(view.queryByRole('checkbox', { name: 'Accept authorisation declaration' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Revoke appointment' }));
  await view.findByText('revoked');
  expect(view.getByText('Not current')).toBeTruthy();
  expect(post).toHaveBeenNthCalledWith(
    2,
    `${REQUESTS}request-a/revoke/`,
    {},
    { ledovaSessionEpoch: getSessionEpoch() },
  );
  expect(view.getByText(COMPANY_AUTHORITY_DECLARATION)).toBeTruthy();
  expect(view.getByText(formatDateTime(revoked.appointment.revokedAt))).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Revoke appointment' })).toBeNull();
  expect(client.getQueryData(['company-authority-requests', getSessionEpoch()])).toEqual([revoked]);
  await fireEvent.press(view.getByRole('button', { name: 'View retained evidence' }));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
});

it('keeps non-admin proposals pending and explains the initial admission requirement', async () => {
  history = [record];
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  expect(
    view.getByText(/Initial admission requires Manage company team in your own requested permissions/),
  ).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Establish appointment' })).toBeNull();
  expect(view.queryByRole('checkbox', { name: 'Accept authorisation declaration' })).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('distinguishes a retained active appointment from current company authority', async () => {
  const ineffective = { ...admitted, appointment: { ...admitted.appointment, isEffective: false } };
  history = [ineffective];
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  expect(view.getByText('active')).toBeTruthy();
  expect(view.getByText('Not current')).toBeTruthy();
  expect(view.queryByText('Current')).toBeNull();
  expect(view.getByRole('button', { name: 'Revoke appointment' })).toBeTruthy();
});

it('refuses an unconfirmed admission response and retries the same declaration without optimistic authority', async () => {
  history = [admissionRequest];
  post
    .mockResolvedValueOnce({ data: { ...admitted, uuid: 'another-request' } })
    .mockResolvedValueOnce({ data: admitted });
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  await fireEvent.press(view.getByRole('checkbox', { name: 'Accept authorisation declaration' }));
  await fireEvent.press(view.getByRole('button', { name: 'Establish appointment' }));
  await view.findByText('The request outcome could not be confirmed. Retry the same request or refresh.');
  expect(view.queryByText('appointment-a')).toBeNull();
  expect(view.getByRole('button', { name: 'Establish appointment' })).toBeEnabled();
  await fireEvent.press(view.getByRole('button', { name: 'Establish appointment' }));
  await view.findByText('appointment-a');
  expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
  expect(view.queryByText('The request outcome could not be confirmed. Retry the same request or refresh.')).toBeNull();
});

it.each([
  ['a pending status', { ...admitted, status: 'pending' }],
  ['no appointment', { ...admitted, appointment: undefined }],
])('refuses an admission response with %s and keeps the declaration available to retry', async (_shape, receipt) => {
  history = [admissionRequest];
  post.mockResolvedValue({ data: receipt });
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  await fireEvent.press(view.getByRole('checkbox', { name: 'Accept authorisation declaration' }));
  await fireEvent.press(view.getByRole('button', { name: 'Establish appointment' }));
  await view.findByText('The request outcome could not be confirmed. Retry the same request or refresh.');
  expect(view.queryByText('appointment-a')).toBeNull();
  expect(view.getByRole('button', { name: 'Establish appointment' })).toBeEnabled();
  expect(client.getQueryData(['company-authority-requests', getSessionEpoch()])).toEqual([admissionRequest]);
});

it.each([
  ['an active appointment', { ...revoked, appointment: { ...revoked.appointment, status: 'active' } }],
  ['no revocation time', { ...revoked, appointment: { ...revoked.appointment, revokedAt: null } }],
  ['a withdrawn request status', { ...revoked, status: 'withdrawn' }],
])('refuses a revocation response with %s and keeps the appointment revocable', async (_shape, receipt) => {
  history = [admitted];
  post.mockResolvedValue({ data: receipt });
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  await fireEvent.press(view.getByRole('button', { name: 'Revoke appointment' }));
  await view.findByText('The request outcome could not be confirmed. Retry the same request or refresh.');
  expect(view.getByText('active')).toBeTruthy();
  expect(view.queryByText('revoked')).toBeNull();
  expect(view.getByRole('button', { name: 'Revoke appointment' })).toBeEnabled();
  expect(client.getQueryData(['company-authority-requests', getSessionEpoch()])).toEqual([admitted]);
});

it.each(['success', 'refusal'])('suppresses a previous session admission %s', async (outcome) => {
  history = [admissionRequest];
  const response = deferred({ data: admitted });
  post.mockReturnValue(response.promise);
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  await fireEvent.press(view.getByRole('checkbox', { name: 'Accept authorisation declaration' }));
  await fireEvent.press(view.getByRole('button', { name: 'Establish appointment' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  history = [];
  await act(() => invalidateSessionScope());
  await view.findByText('You have not submitted an authority request.');
  await act(() => {
    if (outcome === 'success') response.resolve({ data: admitted });
    else response.reject({ response: { data: { detail: 'Earlier session admission refused' } } });
  });
  expect(view.queryByText('appointment-a')).toBeNull();
  expect(view.queryByText('Earlier session admission refused')).toBeNull();
  expect(client.getQueryData(['company-authority-requests', getSessionEpoch()])).toEqual([]);
});

it('keeps refused history hidden after a delayed admission and recovers only through a successful read', async () => {
  history = [admissionRequest];
  const response = deferred({ data: admitted });
  post.mockReturnValue(response.promise);
  const view = await render(<CompanyAuthorityScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  await fireEvent.press(view.getByRole('checkbox', { name: 'Accept authorisation declaration' }));
  await fireEvent.press(view.getByRole('button', { name: 'Establish appointment' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  historyReadFailure = true;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh' }));
  await view.findByText('Your requests could not be loaded.');
  await act(() => response.resolve({ data: admitted }));
  expect(client.getQueryState(['company-authority-requests', getSessionEpoch()])?.status).toBe('error');
  expect(view.queryByText('appointment-a')).toBeNull();
  historyReadFailure = false;
  history = [admitted];
  await fireEvent.press(view.getByRole('button', { name: 'Retry requests' }));
  await fireEvent.press(await view.findByRole('button', { name: 'Request retained.pdf' }));
  await view.findByText('appointment-a');
});

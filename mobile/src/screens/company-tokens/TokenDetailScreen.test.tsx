import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { COMPANY_TOKEN_ENDPOINTS as URLS, REGISTER_COPY } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { cache, files, resetFiles } from '../../testSupport/documentFiles';
import { invalidateSessionScope } from '../../services/sessionScope';
import { TokenDetailScreen } from './TokenDetailScreen';

jest.mock('../../hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({ userAccount: { role: 'company' }, isLoading: false, isError: false }),
}));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));

const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const uuid = 'ordinary';
const token = {
  uuid,
  companyUuid: 'company',
  companyName: 'Paper Company',
  name: 'Ordinary shares',
  symbol: 'ORD',
  status: 'deployed',
  statusDisplay: 'Deployed',
  tokenTypeDisplay: 'Ordinary',
  totalSupply: '1000',
  decimals: 0,
  isTransferable: true,
  isDivisible: false,
};
const register = {
  token,
  initialized: true,
  issuedSupply: '9007199254740993',
  waitingEffects: 2,
  totalHolders: 0,
  holders: [],
};
const issuance = {
  uuid: 'issuance',
  amount: '9007199254740993',
  recipientAddress: '0xrecipient',
  statusDisplay: 'Completed',
  createdAt: '2026-09-01',
  subscriptionReference: 'APP-9',
};
const request = {
  uuid: 'request',
  amount: 20,
  tokenSymbol: 'ORD',
  recipientAddress: '0xrecipient',
  statusDisplay: 'Rejected',
  reason: 'Member allotment',
  createdAt: '2026-09-01',
  rejectionReason: 'Missing resolution',
  executionNotes: 'First attempt refused',
};
const capital = {
  uuid: 'capital',
  purpose: 'Additional capital',
  additionalShares: 10,
  newAuthorizedTotal: 1010,
  status: 'draft',
  statusDisplay: 'Draft',
  createdAt: '2026-09-01',
};
const page = (rows: unknown[], next: string | null = null) => ({ data: { results: rows, count: rows.length, next } });
let client: QueryClient;
let read: (url: string, number: number) => Promise<unknown>;
let classRecord: typeof token;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function screen() {
  return <TokenDetailScreen route={{ params: { uuid }, key: 'class', name: 'TokenDetail' }} navigation={{} as never} />;
}
function defaultRead(url: string, number: number): Promise<unknown> {
  if (url === URLS.DETAIL(uuid)) return Promise.resolve({ data: classRecord });
  if (url.includes('/companies/')) return Promise.resolve({ data: { uuid: 'company', status: 'active' } });
  if (url === URLS.HOLDERS(uuid)) return Promise.resolve({ data: register });
  if (url === URLS.ISSUANCES(uuid))
    return Promise.resolve(number === 1 ? page([], 'https://api.example.test/?page=2') : page([issuance]));
  if (url === URLS.ISSUANCE_REQUESTS)
    return Promise.resolve(number === 1 ? page([], 'https://api.example.test/?page=2') : page([request]));
  if (url === URLS.CAPITAL_INCREASES)
    return Promise.resolve(number === 1 ? page([], 'https://api.example.test/?page=2') : page([capital]));
  if (url === URLS.REGISTER_EXPORT(uuid))
    return Promise.resolve({ data: Uint8Array.from('member,shares', (c) => c.charCodeAt(0)).buffer });
  return Promise.reject(new Error(`Unexpected ${url}`));
}
beforeEach(() => {
  resetFiles();
  classRecord = { ...token };
  read = defaultRead;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
  });
  get.mockReset();
  get.mockImplementation(
    (url, config) =>
      read(url, (config?.params as { page?: number } | undefined)?.page ?? 1) as ReturnType<typeof apiClient.get>,
  );
  post.mockReset();
  post.mockResolvedValue({ data: {} });
  jest.mocked(Sharing.shareAsync).mockClear();
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

it('reads every page of each history and keeps exact confirmed quantities and register state', async () => {
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByText('Application APP-9')).toBeTruthy());
  expect(view.getByText('9,007,199,254,740,993 shares to 0xrecipient')).toBeTruthy();
  expect(view.getByText(REGISTER_COPY.WAITING_NOTE(2))).toBeTruthy();
  expect(view.getByText('Missing resolution')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Execution history request' }));
  expect(view.getByText('First attempt refused')).toBeTruthy();
  expect(get).toHaveBeenCalledWith(URLS.ISSUANCES(uuid), { params: { page: 2 } });
  expect(get).toHaveBeenCalledWith(URLS.ISSUANCE_REQUESTS, { params: { token: uuid, page: 2 } });
  expect(get).toHaveBeenCalledWith(URLS.CAPITAL_INCREASES, { params: { token: uuid, page: 2 } });
});

it.each([
  [URLS.ISSUANCES(uuid), 'issuances', 'No issuances yet.'],
  [URLS.ISSUANCE_REQUESTS, 'issuance requests', 'No issuance requests yet.'],
  [URLS.CAPITAL_INCREASES, 'authorised share requests', 'No authorised share requests yet.'],
])('does not call a failed second page an empty history: %s', async (url, label, empty) => {
  read = async (path, number) =>
    path === url && number === 2 ? Promise.reject(new Error('Unavailable')) : defaultRead(path, number);
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByText(`We couldn’t load ${label}.`)).toBeTruthy());
  expect(view.queryByText(empty)).toBeNull();
  read = defaultRead;
  await fireEvent.press(view.getByRole('button', { name: `Retry ${label}` }));
  await waitFor(() => expect(view.queryByText(`We couldn’t load ${label}.`)).toBeNull());
});

it('preserves an issuance draft after failed class refresh and prevents stale submission', async () => {
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByRole('button', { name: 'Request issuance' })).toBeTruthy());
  await fireEvent.press(view.getByRole('button', { name: 'Request issuance' }));
  await fireEvent.changeText(view.getByLabelText('Recipient address'), '0xmember');
  await fireEvent.changeText(view.getByLabelText('Shares to issue'), '25');
  read = async (url, number) =>
    url === URLS.DETAIL(uuid) ? Promise.reject(new Error('Unavailable')) : defaultRead(url, number);
  await act(() => client.invalidateQueries({ queryKey: ['company-token', uuid], exact: true }));
  await waitFor(() =>
    expect(
      view.getByText('The class state could not be refreshed. Your draft is kept; retry before submitting.'),
    ).toBeTruthy(),
  );
  expect(view.getByLabelText('Shares to issue').props.value).toBe('25');
  expect(view.getByRole('button', { name: 'Submit issuance request' })).toBeDisabled();
  expect(post).not.toHaveBeenCalled();
  read = defaultRead;
  await fireEvent.press(view.getByRole('button', { name: 'Retry class state' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Submit issuance request' })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: 'Submit issuance request' }));
  await waitFor(() => expect(view.queryByLabelText('Shares to issue')).toBeNull());
  expect(post).toHaveBeenCalledWith(URLS.ISSUE(uuid), { recipient: '0xmember', amount: 25, reason: undefined });
});

it.each(['1.5', '1e3', '-1', '0', '2147483648', '9007199254740993'])(
  'rejects invalid issuance quantity %s before the request',
  async (amount) => {
    const view = await render(screen(), { wrapper });
    await waitFor(() => expect(view.getByRole('button', { name: 'Request issuance' })).toBeTruthy());
    await fireEvent.press(view.getByRole('button', { name: 'Request issuance' }));
    await fireEvent.changeText(view.getByLabelText('Recipient address'), '0xmember');
    await fireEvent.changeText(view.getByLabelText('Shares to issue'), amount);
    expect(view.getByRole('button', { name: 'Submit issuance request' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  },
);

it('keeps pending issuance inputs locked and the modal mounted; a refusal preserves the draft', async () => {
  let refuse!: (error: Error) => void;
  post.mockImplementation(
    () =>
      new Promise((_, reject) => {
        refuse = reject;
      }),
  );
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByRole('button', { name: 'Request issuance' })).toBeTruthy());
  await fireEvent.press(view.getByRole('button', { name: 'Request issuance' }));
  await fireEvent.changeText(view.getByLabelText('Recipient address'), '0xmember');
  await fireEvent.changeText(view.getByLabelText('Shares to issue'), '1');
  await fireEvent.press(view.getByRole('button', { name: 'Submit issuance request' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Cancel' })).toBeDisabled());
  expect(view.getByLabelText('Shares to issue').props.editable).toBe(false);
  await fireEvent(view.getByLabelText('Shares to issue'), 'requestClose');
  expect(view.getByLabelText('Shares to issue')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Submit issuance request' }));
  expect(post).toHaveBeenCalledTimes(1);
  await act(() => refuse(new Error('Refused')));
  await waitFor(() => expect(view.getByRole('button', { name: 'Cancel' })).toBeEnabled());
  expect(view.getByLabelText('Shares to issue').props.value).toBe('1');
  expect(view.getByRole('alert')).toBeTruthy();
});

it('raises only the exact authorised cap and separately submits a draft for review', async () => {
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByRole('button', { name: 'Raise authorised shares' })).toBeTruthy());
  await fireEvent.press(view.getByRole('button', { name: 'Raise authorised shares' }));
  await fireEvent.changeText(view.getByLabelText('Additional shares'), '25');
  await fireEvent.changeText(view.getByLabelText('Purpose'), ' New members ');
  await fireEvent.changeText(view.getByLabelText('Board resolution reference'), ' BR-1 ');
  expect(view.getByText('New authorised total: 1,025')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Create request' }));
  await waitFor(() => expect(view.queryByLabelText('Additional shares')).toBeNull());
  expect(post).toHaveBeenCalledWith(URLS.CAPITAL_INCREASES, {
    token: uuid,
    additionalShares: 25,
    newAuthorizedTotal: 1025,
    purpose: 'New members',
    boardResolutionReference: 'BR-1',
    shareholderApprovalReference: undefined,
  });
  await fireEvent.press(view.getByRole('button', { name: 'Submit Additional capital for review' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith(URLS.CAPITAL_INCREASE_SUBMIT('capital')));
});

it('retains exact large cap arithmetic but refuses a raise beyond the current request contract', async () => {
  classRecord.totalSupply = '9007199254740993';
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByRole('button', { name: 'Raise authorised shares' })).toBeTruthy());
  await fireEvent.press(view.getByRole('button', { name: 'Raise authorised shares' }));
  await fireEvent.changeText(view.getByLabelText('Additional shares'), '1');
  await fireEvent.changeText(view.getByLabelText('Purpose'), 'New members');
  await fireEvent.changeText(view.getByLabelText('Board resolution reference'), 'BR-1');
  expect(view.getByText('New authorised total: 9,007,199,254,740,994')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Create request' })).toBeDisabled();
  expect(post).not.toHaveBeenCalled();
});

it('blocks an open request when the refreshed class is paused and keeps its inputs', async () => {
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByRole('button', { name: 'Raise authorised shares' })).toBeTruthy());
  await fireEvent.press(view.getByRole('button', { name: 'Raise authorised shares' }));
  await fireEvent.changeText(view.getByLabelText('Additional shares'), '1');
  classRecord = { ...token, status: 'paused', statusDisplay: 'Paused' };
  await act(() => client.invalidateQueries({ queryKey: ['company-token', uuid], exact: true }));
  await waitFor(() =>
    expect(view.getByText('The class must be deployed and unpaused before you request a raise.')).toBeTruthy(),
  );
  expect(view.getByLabelText('Additional shares').props.value).toBe('1');
  expect(view.getByRole('button', { name: 'Create request' })).toBeDisabled();
});

it('requires a current active company before deployment and allows retry after failed company state', async () => {
  classRecord = { ...token, status: 'draft', statusDisplay: 'Draft' };
  read = async (url, number) =>
    url.includes('/companies/') ? { data: { status: 'review' } } : defaultRead(url, number);
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByRole('button', { name: 'Deploy class' })).toBeDisabled());
  expect(view.queryByRole('button', { name: 'Request issuance' })).toBeNull();
  read = async (url, number) =>
    url.includes('/companies/') ? Promise.reject(new Error('Unavailable')) : defaultRead(url, number);
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  await waitFor(() => expect(view.getByText('We couldn’t load company state.')).toBeTruthy());
  expect(view.queryByRole('button', { name: 'Deploy class' })).toBeNull();
  read = defaultRead;
  await fireEvent.press(view.getByRole('button', { name: 'Retry company state' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Deploy class' })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: 'Deploy class' }));
  await waitFor(() => expect(post).toHaveBeenCalledWith(URLS.DEPLOY(uuid)));
});

it('shares an authenticated register copy and rejects a download from a retired session', async () => {
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByRole('button', { name: REGISTER_COPY.DOWNLOAD })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: REGISTER_COPY.DOWNLOAD }));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(`${cache}ledova-document-views-v1/register-ordinary.csv`, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
    }),
  );
  expect(files.size).toBe(1);
  let finish!: (value: unknown) => void;
  read = async (url, number) =>
    url === URLS.REGISTER_EXPORT(uuid)
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : defaultRead(url, number);
  await waitFor(() => expect(view.getByRole('button', { name: REGISTER_COPY.DOWNLOAD })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: REGISTER_COPY.DOWNLOAD }));
  await waitFor(() => expect(finish).toBeDefined());
  await act(() => invalidateSessionScope());
  await act(async () => finish(await defaultRead(URLS.REGISTER_EXPORT(uuid), 1)));
  await waitFor(() => expect(view.getByText(REGISTER_COPY.DOWNLOAD_FAILED)).toBeTruthy());
  expect(files.size).toBe(0);
  expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
});

it('retains the raise draft across a failed read, locks it while sending, and allows correction after refusal', async () => {
  let refuse!: (error: Error) => void;
  post.mockImplementation(
    () =>
      new Promise((_, reject) => {
        refuse = reject;
      }),
  );
  const view = await render(screen(), { wrapper });
  await waitFor(() => expect(view.getByRole('button', { name: 'Raise authorised shares' })).toBeTruthy());
  await fireEvent.press(view.getByRole('button', { name: 'Raise authorised shares' }));
  await fireEvent.changeText(view.getByLabelText('Additional shares'), '25');
  await fireEvent.changeText(view.getByLabelText('Purpose'), 'New members');
  await fireEvent.changeText(view.getByLabelText('Board resolution reference'), 'BR-1');
  read = async (url, number) =>
    url === URLS.DETAIL(uuid) ? Promise.reject(new Error('Unavailable')) : defaultRead(url, number);
  await act(() => client.invalidateQueries({ queryKey: ['company-token', uuid], exact: true }));
  await waitFor(() =>
    expect(
      view.getByText('The class state could not be refreshed. Your draft is kept; retry before submitting.'),
    ).toBeTruthy(),
  );
  expect(view.getByRole('button', { name: 'Create request' })).toBeDisabled();
  expect(view.getByLabelText('Board resolution reference').props.value).toBe('BR-1');
  read = defaultRead;
  await fireEvent.press(view.getByRole('button', { name: 'Retry class state' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Create request' })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: 'Create request' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Cancel' })).toBeDisabled());
  expect(view.getByLabelText('Board resolution reference').props.editable).toBe(false);
  await fireEvent.press(view.getByRole('button', { name: 'Dismiss request', includeHiddenElements: true }));
  expect(view.getByLabelText('Additional shares')).toBeTruthy();
  expect(post).toHaveBeenCalledTimes(1);
  await act(() => refuse(new Error('Refused')));
  await waitFor(() => expect(view.getByRole('button', { name: 'Create request' })).toBeEnabled());
  expect(view.getByLabelText('Additional shares').props.value).toBe('25');
  expect(view.getByRole('alert')).toBeTruthy();
});

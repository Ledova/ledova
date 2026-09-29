import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { PUBLICATION_COPY } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { cache, files, resetFiles } from '../../testSupport/documentFiles';
import { CompanyPublicationsScreen } from './CompanyPublicationsScreen';

let mockRole = 'company';
let mockAccessError = false;
const mockNavigate = jest.fn();
const mockRetryAccess = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => ({
    userAccount: { role: mockRole },
    isLoading: false,
    isError: mockAccessError,
    refetch: mockRetryAccess,
  }),
}));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));

const LIST = '/api/v1/publications/';
const COMPANY = '/api/v1/companies/company-one/';
const statement = {
  uuid: 'issuer-paper',
  kind: 'holding_statement',
  title: 'Annual holding statement 2026',
  companyName: 'Synthetic Holdings Pty Ltd',
  tokenName: 'Synthetic ordinary shares',
  tokenSymbol: 'SYN',
  recordDate: '2026-09-20',
  shares: '100',
  createdAt: '2026-09-21T02:00:00Z',
  question: null,
  resolutionKind: null,
  opensAt: null,
  closesAt: null,
  myBallot: null,
  ballotOutstanding: false,
  result: null,
  ratePerShare: null,
  currency: null,
  declaredOn: null,
  paymentDate: null,
  myEntitlement: null,
  myRecordedEntitlement: null,
  myPaymentRecord: null,
};

const FILE = `${LIST}${statement.uuid}/file/`;
const copy = `${cache}ledova-document-views-v1/${statement.uuid}.pdf`;
const get = jest.mocked(apiClient.get);
let client: QueryClient;
let rows: unknown[];
let pages: (page: number) => Promise<unknown>;
let company: () => Promise<unknown>;
let document: () => Promise<unknown>;
const fail = () => Promise.reject(new Error('Synthetic read refusal'));
const listed = (results: unknown[], next: string | null = null) => ({
  data: { results, count: results.length, next, previous: null },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  resetFiles();
  mockRole = 'company';
  mockAccessError = false;
  rows = [statement];
  pages = async () => listed(rows);
  company = async () => ({ data: { uuid: 'company-one', name: 'Synthetic Company' } });
  document = async () => ({
    data: Uint8Array.from('%PDF', (character) => character.charCodeAt(0)).buffer,
    headers: { 'content-type': 'application/pdf; charset=binary' },
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  get.mockReset();
  get.mockImplementation(async (url, config) => {
    if (url === '/api/v1/companies/') return listed([{ uuid: 'company-one' }]);
    if (url === COMPANY) return company();
    if (url === LIST) return pages((config?.params as { page?: number } | undefined)?.page ?? 1);
    if (url === FILE) return document();
    throw new Error(`Unexpected GET ${url}`);
  });
  jest.mocked(Sharing.isAvailableAsync).mockReset().mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockReset().mockResolvedValue(undefined);
  jest.mocked(apiClient.post).mockReset();
  mockNavigate.mockReset();
  mockRetryAccess.mockReset();
});
afterEach(async () => {
  await act(async () => {
    await client.cancelQueries();
  });
  await cleanup();
  client.clear();
});

it.each(['company', 'both'])(
  'reads every issuer page for a %s account without using personal notices',
  async (role) => {
    mockRole = role;
    client.setQueryData(['publications', 'addressed', 'me'], {
      pages: [listed([{ ...statement, title: 'Personal paper' }])],
    });
    pages = async (page) =>
      listed(
        page === 1 ? rows : [{ ...statement, uuid: 'last-paper', title: 'Last issuer paper' }],
        page === 1 ? 'https://example.test/?page=2' : null,
      );
    const view = await render(<CompanyPublicationsScreen />, { wrapper });
    expect(await view.findByText('Last issuer paper')).toBeTruthy();
    expect(view.getByText('2 publications')).toBeTruthy();
    expect(view.queryByText('Personal paper')).toBeNull();
    expect(get).toHaveBeenCalledWith(LIST, { params: { page: 1, issuer: 'company-one' } });
    expect(get).toHaveBeenCalledWith(LIST, { params: { page: 2, issuer: 'company-one' } });
    await fireEvent.press(view.getByRole('button', { name: 'Open Notices' }));
    expect(mockNavigate).toHaveBeenCalledWith('Publications');
  },
);

it('does not claim a complete count or expose first-page records while a later page is pending', async () => {
  const second = deferred<unknown>();
  pages = (page) => (page === 1 ? Promise.resolve(listed(rows, 'https://example.test/?page=2')) : second.promise);
  const view = await render(<CompanyPublicationsScreen />, { wrapper });
  expect(await view.findByText('Loading company publications…')).toBeTruthy();
  await waitFor(() => expect(get).toHaveBeenCalledWith(LIST, { params: { page: 2, issuer: 'company-one' } }));
  expect(view.queryByText(statement.title)).toBeNull();
  expect(view.queryByText('1 publication')).toBeNull();
  await act(async () => second.resolve(listed([{ ...statement, uuid: 'last', title: 'Last paper' }])));
  expect(await view.findByText('2 publications')).toBeTruthy();
});

it('refuses a refused second page without showing an empty or partial list', async () => {
  pages = async (page) => (page === 1 ? listed(rows, 'https://example.test/?page=2') : fail());
  const view = await render(<CompanyPublicationsScreen />, { wrapper });
  expect(
    await view.findByText("Your company's publications could not be loaded. Try again before continuing."),
  ).toBeTruthy();
  expect(view.queryByText(statement.title)).toBeNull();
  expect(view.queryByText("Nothing has been published to this company's members yet.")).toBeNull();
  pages = async () => listed(rows);
  await fireEvent.press(view.getByText('Retry publications'));
  expect(await view.findByText(statement.title)).toBeTruthy();
});

it('distinguishes an owned company with no publications from a missing company', async () => {
  rows = [];
  const view = await render(<CompanyPublicationsScreen />, { wrapper });
  expect(await view.findByText("Nothing has been published to this company's members yet.")).toBeTruthy();
  expect(view.queryByText(PUBLICATION_COPY.EMPTY)).toBeNull();
  expect(view.queryByText(PUBLICATION_COPY.OPEN)).toBeNull();
  await cleanup();
  client.clear();
  get.mockResolvedValue(listed([]));
  const missing = await render(<CompanyPublicationsScreen />, { wrapper });
  expect(await missing.findByText('No company information available.')).toBeTruthy();
  expect(missing.queryByText("Nothing has been published to this company's members yet.")).toBeNull();
});

it.each(['investor', 'company-error'])('refuses issuer reads and documents for %s access', async (mode) => {
  mockRole = mode === 'investor' ? 'investor' : 'company';
  mockAccessError = mode === 'company-error';
  const view = await render(<CompanyPublicationsScreen />, { wrapper });
  expect(view.getByText('Verify your company access before opening Company.')).toBeTruthy();
  expect(get).not.toHaveBeenCalled();
  expect(view.queryByText(PUBLICATION_COPY.OPEN)).toBeNull();
  if (mockAccessError) {
    await fireEvent.press(view.getByText('Retry company access'));
    expect(mockRetryAccess).toHaveBeenCalledTimes(1);
  }
});

it('hides stale records when the company refresh fails and rechecks that company on retry', async () => {
  const view = await render(<CompanyPublicationsScreen />, { wrapper });
  expect(await view.findByText(statement.title)).toBeTruthy();
  const pending = deferred<unknown>();
  company = () => pending.promise;
  await fireEvent.press(view.getByText('Refresh'));
  await waitFor(() =>
    expect(view.getByRole('button', { name: `${PUBLICATION_COPY.OPEN}: ${statement.title}` })).toBeDisabled(),
  );
  await act(async () => pending.resolve(Promise.reject(new Error('Company unavailable'))));
  expect(await view.findByText('Company information could not be loaded. Try again before continuing.')).toBeTruthy();
  expect(view.queryByText(statement.title)).toBeNull();
  company = async () => ({ data: { uuid: 'company-one', name: 'Synthetic Company' } });
  await fireEvent.press(view.getByText('Retry company information'));
  expect(await view.findByText(statement.title)).toBeTruthy();
});

it('blocks document actions during publication refresh and hides stale records after refusal', async () => {
  const view = await render(<CompanyPublicationsScreen />, { wrapper });
  expect(await view.findByText(statement.title)).toBeTruthy();
  const pending = deferred<unknown>();
  pages = () => pending.promise;
  await fireEvent.press(view.getByText('Refresh'));
  const button = view.getByRole('button', { name: `${PUBLICATION_COPY.OPEN}: ${statement.title}` });
  await waitFor(() => expect(button).toBeDisabled());
  await fireEvent.press(button);
  expect(get.mock.calls.some(([url]) => url === FILE)).toBe(false);
  await act(async () => pending.resolve(Promise.reject(new Error('List unavailable'))));
  expect(
    await view.findByText("Your company's publications could not be loaded. Try again before continuing."),
  ).toBeTruthy();
  expect(view.queryByText(statement.title)).toBeNull();
  expect(view.queryByText('0 publications')).toBeNull();
  pages = async () => listed(rows);
  await fireEvent.press(view.getByText('Retry publications'));
  expect(await view.findByText(statement.title)).toBeTruthy();
});

it('shows exact issuer tallies, eligible shares and dividend rates without member actions or entitlements', async () => {
  rows = [
    {
      ...statement,
      kind: 'resolution',
      question: 'Adopt the fictional constitution?',
      resolutionKind: 'ordinary',
      opensAt: '2020-01-01T00:00:00Z',
      closesAt: '2020-01-02T00:00:00Z',
      ballotOutstanding: true,
      result: {
        for: { shares: '9007199254740993', members: 2 },
        against: { shares: '5', members: 1 },
        abstain: { shares: '0', members: 0 },
        eligible: { shares: '9007199254740999', members: 4 },
        carried: true,
      },
    },
    {
      ...statement,
      uuid: 'dividend',
      title: 'Fictional dividend',
      kind: 'distribution',
      ratePerShare: '0.000001',
      currency: 'AUD',
      declaredOn: '2026-09-20',
      paymentDate: '2026-10-01',
      myEntitlement: '1234.56',
    },
  ];
  const view = await render(<CompanyPublicationsScreen />, { wrapper });
  expect(await view.findByText('9,007,199,254,740,993 shares · 2 members')).toBeTruthy();
  expect(view.getByText('9,007,199,254,740,999 shares · 4 members')).toBeTruthy();
  expect(view.getByText('AUD 0.000001 per share')).toBeTruthy();
  expect(view.getByText(PUBLICATION_COPY.CARRIED)).toBeTruthy();
  expect(view.getAllByText('Published')).toHaveLength(2);
  expect(view.queryByText(PUBLICATION_COPY.HOLDING_LABEL)).toBeNull();
  expect(view.queryByText(PUBLICATION_COPY.ENTITLEMENT_LABEL)).toBeNull();
  expect(view.queryByRole('button', { name: /For:/ })).toBeNull();
  expect(apiClient.post).not.toHaveBeenCalled();
});

it.each([
  ['upcoming', '2099-01-01T00:00:00Z', '2099-01-02T00:00:00Z', PUBLICATION_COPY.NOT_OPEN_YET],
  ['open', '2020-01-01T00:00:00Z', '2099-01-02T00:00:00Z', 'Voting is open'],
  ['closed', '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z', PUBLICATION_COPY.RESULT_PENDING],
])(
  'keeps %s resolutions read-only even when the owner is also an eligible member',
  async (_, opensAt, closesAt, label) => {
    rows = [
      { ...statement, kind: 'resolution', question: 'Fictional question', opensAt, closesAt, ballotOutstanding: true },
    ];
    const view = await render(<CompanyPublicationsScreen />, { wrapper });
    expect(await view.findByText(label)).toBeTruthy();
    expect(view.queryByRole('button', { name: /For:/ })).toBeNull();
  },
);

it('uses the audited file endpoint, captured session, MIME filename and managed share copy', async () => {
  const view = await render(<CompanyPublicationsScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: `${PUBLICATION_COPY.OPEN}: ${statement.title}` }));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(copy, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' }),
  );
  expect(get).toHaveBeenCalledWith(FILE, { ledovaSessionEpoch: getSessionEpoch(), responseType: 'arraybuffer' });
  expect(files.get(copy)?.content).toBe('%PDF');
});

it.each([503, 404])(
  'shows a safe %i document refusal, writes no file and retries the stored document',
  async (status) => {
    document = () => Promise.reject({ response: { status } });
    const view = await render(<CompanyPublicationsScreen />, { wrapper });
    await fireEvent.press(await view.findByRole('button', { name: `${PUBLICATION_COPY.OPEN}: ${statement.title}` }));
    expect(
      await view.findByText(status === 503 ? PUBLICATION_COPY.UNDELIVERABLE : PUBLICATION_COPY.FAILED),
    ).toBeTruthy();
    expect(files.has(copy)).toBe(false);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    document = async () => ({ data: new ArrayBuffer(4), headers: { 'content-type': 'application/pdf' } });
    await fireEvent.press(view.getByRole('button', { name: `${PUBLICATION_COPY.OPEN}: ${statement.title}` }));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  },
);

it('does not download when sharing is unavailable', async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
  const view = await render(<CompanyPublicationsScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: `${PUBLICATION_COPY.OPEN}: ${statement.title}` }));
  expect(await view.findByText('Sharing is not available on this device.')).toBeTruthy();
  expect(get.mock.calls.some(([url]) => url === FILE)).toBe(false);
});

it('admits one opening while availability is pending, and retires it when the session changes', async () => {
  const pending = deferred<boolean>();
  jest.mocked(Sharing.isAvailableAsync).mockReturnValue(pending.promise);
  const view = await render(<CompanyPublicationsScreen />, { wrapper });
  const button = await view.findByRole('button', { name: `${PUBLICATION_COPY.OPEN}: ${statement.title}` });
  await fireEvent.press(button);
  await waitFor(() => expect(button).toBeDisabled());
  await fireEvent.press(button);
  expect(Sharing.isAvailableAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    invalidateSessionScope();
    pending.resolve(true);
  });
  expect(get.mock.calls.some(([url]) => url === FILE)).toBe(false);
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(view.queryByText(PUBLICATION_COPY.FAILED)).toBeNull();
});

it.each(['session', 'role', 'unmount'])(
  'retires a downloaded copy on %s change without sharing or showing a stale error',
  async (change) => {
    const pending = deferred<unknown>();
    document = () => pending.promise;
    const view = await render(<CompanyPublicationsScreen />, { wrapper });
    await fireEvent.press(await view.findByRole('button', { name: `${PUBLICATION_COPY.OPEN}: ${statement.title}` }));
    await waitFor(() => expect(get.mock.calls.some(([url]) => url === FILE)).toBe(true));
    if (change === 'session') await act(async () => invalidateSessionScope());
    if (change === 'role') {
      mockRole = 'investor';
      await view.rerender(<CompanyPublicationsScreen />);
    }
    if (change === 'unmount') await view.unmount();
    await act(async () =>
      pending.resolve({ data: new ArrayBuffer(4), headers: { 'content-type': 'application/pdf' } }),
    );
    expect(files.has(copy)).toBe(false);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    if (change !== 'unmount') expect(view.queryByText(PUBLICATION_COPY.FAILED)).toBeNull();
  },
);

it('shows the company name on a publication record as body text under its title', async () => {
  const view = await render(<CompanyPublicationsScreen />, { wrapper });
  const title = await view.findByRole('header', { name: statement.title });
  const record = title.parent!;
  const name = view.getAllByText(statement.companyName).find((node) => node.parent === record)!;
  expect(name).toHaveStyle({ fontFamily: 'InstrumentSans_400Regular', fontSize: 14, lineHeight: 21 });
  expect(name).not.toHaveStyle({ fontSize: 17 });
  expect(name.props.accessibilityRole).toBeUndefined();
});

import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiClientProvider,
  formatDateTime,
  type AccountRole,
  type Subscription,
  type SubscriptionStatus,
} from '@ledova/shared';
import type { AxiosInstance } from 'axios';
import { HomeScreen } from '../index';
import { apiClient } from '../../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../../services/sessionScope';

const mockNavigate = jest.fn();
const mockRefetchHoldings = jest.fn(async () => undefined);
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('../../../services/apiClient', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('../useShareHoldings', () => ({
  useShareHoldings: () => ({
    data: [],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: mockRefetchHoldings,
  }),
}));

const get = jest.mocked(apiClient.get);
const NOTHING = { openResolutions: 0, nextClosesAt: null, publishedSince: 0, dividendsWithoutRecord: 0 };
const AUTH = '/api/auth/verify/';
const PREFERENCES = '/api/user-preferences/';
const APPLICATIONS = '/api/v1/subscriptions/';
const NOTICES = '/api/v1/publications/summary/';
let client: QueryClient;
let role: AccountRole | null;
let summary: Record<string, unknown>;
let pages: Record<number, Subscription[]>;
let fail: string | undefined;
let next: (page: number) => string | null;

function application(status: SubscriptionStatus, overrides: Partial<Subscription> = {}): Subscription {
  return {
    uuid: status,
    offeringUuid: 'offering',
    companyName: `${status} Company`,
    tokenName: 'Ordinary',
    tokenSymbol: 'ORD',
    status,
    statusDisplay: status,
    quantity: 250,
    allottedQuantity: null,
    pricePerShare: '1.00',
    amountDue: '250.00',
    amountReceived: null,
    currency: 'AUD',
    settlementRail: 'bank_transfer',
    settlementRailDisplay: 'Bank transfer',
    reference: '',
    paymentDueAt: null,
    walletAddress: `0x${'1'.repeat(40)}`,
    createdAt: '2026-09-20T00:00:00Z',
    ...overrides,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient as AxiosInstance}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  get.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  role = 'investor';
  summary = NOTHING;
  pages = { 1: [] };
  fail = undefined;
  next = (page) => (pages[page + 1] ? `https://example.test/api/v1/subscriptions/?page=${page + 1}` : null);
  get.mockImplementation(async (url, config) => {
    if (fail === url || (fail === 'page2' && (config?.params as { page?: number } | undefined)?.page === 2))
      throw new Error('Fictional unavailable source');
    if (url === AUTH) return { data: { valid: true } };
    if (url === PREFERENCES) return { data: { userAccount: role ? { uuid: 'account', role } : null } };
    if (url === NOTICES) return { data: summary };
    if (url === APPLICATIONS) {
      const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
      return {
        data: { results: pages[page], next: next(page), count: Object.values(pages).flat().length, previous: null },
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.useRealTimers();
});

it('groups actionable applications with votes and operator work with company records, omitting closed work', async () => {
  pages = {
    1: [
      'draft',
      'submitted',
      'accepted',
      'awaiting_payment',
      'paid',
      'allotted',
      'rejected',
      'withdrawn',
      'refunded',
    ].map((status) => application(status as SubscriptionStatus)),
  };
  summary = { openResolutions: 2, nextClosesAt: '2026-10-03T05:00:00Z', publishedSince: 3, dividendsWithoutRecord: 1 };
  const view = await render(<HomeScreen />, { wrapper });
  expect(await view.findByText('draft Company')).toBeTruthy();
  const needs = within(view.getByRole('header', { name: 'Needs you' }).parent!);
  const progress = within(view.getByRole('header', { name: 'In progress' }).parent!);
  expect(needs.getByText('awaiting_payment Company')).toBeTruthy();
  expect(needs.getByText('2 resolutions await your vote')).toBeTruthy();
  expect(needs.getByText(`First closes ${formatDateTime(String(summary.nextClosesAt))}`)).toBeTruthy();
  for (const text of [
    'Under review by the operator',
    'Accepted, payment instruction next',
    'Payment received',
    '1 dividend awaits a payment record from the company',
  ])
    expect(progress.getByText(text)).toBeTruthy();
  for (const status of ['allotted', 'rejected', 'withdrawn', 'refunded'])
    expect(view.queryByText(`${status} Company`)).toBeNull();
  expect(view.getByText('3 notices addressed to you in the last 30 days.')).toBeTruthy();
  expect(view.queryByText(/unread|unpaid/i)).toBeNull();
});

it('reads every application page before declaring work complete', async () => {
  pages = { 1: [application('allotted')], 2: [application('draft', { quantity: 1 })] };
  const view = await render(<HomeScreen />, { wrapper });
  expect(await view.findByText('draft Company')).toBeTruthy();
  expect(view.getByText('1 share')).toBeTruthy();
  expect(get).toHaveBeenCalledWith(APPLICATIONS, { params: { page: 2 } });
  expect(view.queryByText('No applications or votes need your attention.')).toBeNull();
});

it('opens the actual application detail route without repeating an amount for partly funded work', async () => {
  pages = { 1: [application('awaiting_payment', { uuid: 'part-paid', amountReceived: '249.50' })] };
  const view = await render(<HomeScreen />, { wrapper });
  await fireEvent.press(await view.findByText('View your payment instruction'));
  expect(mockNavigate).toHaveBeenCalledWith('MainApp', {
    screen: 'Main',
    params: { screen: 'Applications', params: { screen: 'ApplicationDetail', params: { uuid: 'part-paid' } } },
  });
  expect(view.queryByText(/250\.00|249\.50|Pay /)).toBeNull();
});

it('retains personal notice navigation and truthful published counts', async () => {
  summary = { openResolutions: 2, nextClosesAt: '2026-10-03T05:00:00Z', publishedSince: 1, dividendsWithoutRecord: 1 };
  const view = await render(<HomeScreen />, { wrapper });
  expect(await view.findByText('2 resolutions await your vote')).toBeTruthy();
  expect(view.getByText('1 notice addressed to you in the last 30 days.')).toBeTruthy();
  for (const label of ['View notices to vote', 'View dividend notices', 'View notices']) {
    await fireEvent.press(view.getByText(label));
    expect(mockNavigate).toHaveBeenLastCalledWith('MainApp', { screen: 'Main', params: { screen: 'Publications' } });
  }
});

it.each<AccountRole>(['company', 'both'])(
  'only reads investing work for an eligible account role: %s',
  async (accountRole) => {
    role = accountRole;
    pages = { 1: [application('draft')] };
    summary = { ...NOTHING, openResolutions: 1 };
    const view = await render(<HomeScreen />, { wrapper });
    expect(await view.findByText('1 resolution awaits your vote')).toBeTruthy();
    expect(
      await view.findByText(accountRole === 'both' ? 'draft Company' : 'No dividend records are in progress.'),
    ).toBeTruthy();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(get.mock.calls.some(([url]) => url === APPLICATIONS)).toBe(accountRole === 'both');
    expect(Boolean(view.queryByText('draft Company'))).toBe(accountRole === 'both');
  },
);

it.each([AUTH, PREFERENCES])(
  'waits for %s before requesting applications or declaring empty work',
  async (heldSource) => {
    const original = get.getMockImplementation()!;
    let finish!: (value: unknown) => void;
    get.mockImplementation((url, config) =>
      url === heldSource
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : original(url, config),
    );
    const view = await render(<HomeScreen />, { wrapper });
    expect(await view.findByText('Checking your applications…')).toBeTruthy();
    await waitFor(() => expect(get).toHaveBeenCalledWith(NOTICES));
    await waitFor(() => expect(get).toHaveBeenCalledWith(heldSource));
    expect(get.mock.calls.some(([url]) => url === APPLICATIONS)).toBe(false);
    expect(view.queryByText('No applications or votes need your attention.')).toBeNull();
    await act(async () =>
      finish(
        heldSource === AUTH
          ? { data: { valid: true } }
          : { data: { userAccount: { uuid: 'account', role: 'investor' } } },
      ),
    );
    expect(await view.findByText('No applications or votes need your attention.')).toBeTruthy();
  },
);

it('never treats a missing account as an investing role, and recovers independently', async () => {
  role = null;
  const view = await render(<HomeScreen />, { wrapper });
  expect(await view.findByText("We couldn't check your account type or applications.")).toBeTruthy();
  expect(get.mock.calls.some(([url]) => url === APPLICATIONS)).toBe(false);
  role = 'company';
  await fireEvent.press(view.getByText('Try account again'));
  expect(await view.findByText('No votes need your attention.')).toBeTruthy();
  expect(get.mock.calls.some(([url]) => url === APPLICATIONS)).toBe(false);
});

it.each([AUTH, PREFERENCES, APPLICATIONS, 'page2'])(
  'retains notices while %s fails and retries only that source',
  async (failure) => {
    fail = failure;
    pages = { 1: [application('draft')], 2: [application('paid')] };
    summary = { ...NOTHING, openResolutions: 1 };
    const view = await render(<HomeScreen />, { wrapper });
    expect(await view.findByRole('alert')).toBeTruthy();
    expect(view.getByText('View notices to vote')).toBeTruthy();
    expect(view.queryByText('draft Company')).toBeNull();
    expect(view.queryByText('No applications or dividend records are in progress.')).toBeNull();
    const noticeReads = get.mock.calls.filter(([url]) => url === NOTICES).length;
    fail = undefined;
    await fireEvent.press(
      view.getByText([AUTH, PREFERENCES].includes(failure) ? 'Try account again' : 'Try applications again'),
    );
    expect(await view.findByText('draft Company')).toBeTruthy();
    expect(view.getByText('paid Company')).toBeTruthy();
    expect(get.mock.calls.filter(([url]) => url === NOTICES)).toHaveLength(noticeReads);
  },
);

it('retains applications while notices fail and retries notices independently', async () => {
  fail = NOTICES;
  pages = { 1: [application('draft')] };
  const view = await render(<HomeScreen />, { wrapper });
  expect(await view.findByText('draft Company')).toBeTruthy();
  expect(view.getByText("We couldn't check your notices.")).toBeTruthy();
  expect(view.queryByText('No applications or dividend records are in progress.')).toBeNull();
  const applicationReads = get.mock.calls.filter(([url]) => url === APPLICATIONS).length;
  fail = undefined;
  summary = { ...NOTHING, dividendsWithoutRecord: 2 };
  await fireEvent.press(view.getByText('Try notices again'));
  expect(await view.findByText('2 dividends await a payment record from the company')).toBeTruthy();
  expect(get.mock.calls.filter(([url]) => url === APPLICATIONS)).toHaveLength(applicationReads);
});

it('hides stale application actions after a later page fails on refresh', async () => {
  pages = { 1: [application('draft')], 2: [application('paid')] };
  const view = await render(<HomeScreen />, { wrapper });
  expect(await view.findByText('draft Company')).toBeTruthy();
  fail = 'page2';
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['subscriptions'] });
  });
  expect(await view.findByRole('alert')).toBeTruthy();
  expect(view.queryByText('draft Company')).toBeNull();
  expect(view.queryByText('paid Company')).toBeNull();
  expect(view.queryByText('No applications or votes need your attention.')).toBeNull();
});

it.each(['?page=1', '?page=1.5', ''])('rejects malformed or repeated application pages: %s', async (query) => {
  pages = { 1: [application('draft')] };
  next = () => `https://example.test/api/v1/subscriptions/${query}`;
  const view = await render(<HomeScreen />, { wrapper });
  expect(await view.findByText("We couldn't load all your applications.")).toBeTruthy();
  expect(view.queryByText('draft Company')).toBeNull();
  expect(get.mock.calls.filter(([url]) => url === APPLICATIONS)).toHaveLength(1);
});

it('refreshes all work and holdings on a page pull and updates work after existing mutation invalidations', async () => {
  pages = { 1: [application('draft')] };
  const view = await render(<HomeScreen />, { wrapper });
  expect(await view.findByText('Review and submit your draft')).toBeTruthy();
  pages = { 1: [application('submitted')] };
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['subscriptions'] });
  });
  expect(await view.findByText('Under review by the operator')).toBeTruthy();
  expect(view.queryByText('Review and submit your draft')).toBeNull();
  pages = { 1: [application('paid')] };
  summary = { ...NOTHING, openResolutions: 1 };
  await act(async () => {
    (RefreshControl as unknown as { latestRef: { props: { onRefresh: () => void } } }).latestRef.props.onRefresh();
  });
  expect(await view.findByText('Payment received')).toBeTruthy();
  expect(view.getByText('1 resolution awaits your vote')).toBeTruthy();
  expect(mockRefetchHoldings).toHaveBeenCalledTimes(1);
});

it('hides stale notice counts on refresh failure and restores current counts on retry', async () => {
  summary = { ...NOTHING, openResolutions: 2 };
  const view = await render(<HomeScreen />, { wrapper });
  expect(await view.findByText('2 resolutions await your vote')).toBeTruthy();
  fail = NOTICES;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['publications'] });
  });
  expect(await view.findByText("We couldn't check your notices.")).toBeTruthy();
  expect(view.queryByText('2 resolutions await your vote')).toBeNull();
  expect(view.queryByText('View notices to vote')).toBeNull();
  fail = undefined;
  summary = NOTHING;
  await fireEvent.press(view.getByText('Try notices again'));
  expect(await view.findByText('No applications or votes need your attention.')).toBeTruthy();
});

it('updates notice work at its first closing deadline without a manual refresh', async () => {
  jest.useFakeTimers({ advanceTimers: true });
  const closes = new Date(Date.now() + 60000).toISOString();
  summary = { ...NOTHING, openResolutions: 1, nextClosesAt: closes };
  const view = await render(<HomeScreen />, { wrapper });
  expect(await view.findByText('1 resolution awaits your vote')).toBeTruthy();
  summary = NOTHING;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(Date.parse(closes) - Date.now() - 1000);
  });
  expect(get.mock.calls.filter(([url]) => url === NOTICES)).toHaveLength(1);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1000);
  });
  await waitFor(() => expect(view.queryByText('1 resolution awaits your vote')).toBeNull());
  expect(view.getByText('No applications or votes need your attention.')).toBeTruthy();
  expect(get.mock.calls.filter(([url]) => url === NOTICES)).toHaveLength(2);
});

it('discards a retired session response before it can populate an old account cache', async () => {
  client.setDefaultOptions({ queries: { retry: false, gcTime: Infinity } });
  const original = get.getMockImplementation()!;
  let release!: (value: unknown) => void;
  let held = false;
  get.mockImplementation((url, config) => {
    if (url === APPLICATIONS && !held) {
      held = true;
      return new Promise((resolve) => {
        release = resolve;
      });
    }
    return original(url, config);
  });
  const epoch = getSessionEpoch();
  const view = await render(<HomeScreen />, { wrapper });
  await waitFor(() => expect(held).toBe(true));
  await act(async () => invalidateSessionScope());
  expect(await view.findByText('No applications or votes need your attention.')).toBeTruthy();
  await act(async () =>
    release({ data: { results: [application('draft', { companyName: 'Retired account' })], next: null } }),
  );
  expect(view.queryByText('Retired account')).toBeNull();
  expect(client.getQueryData(['subscriptions', 'holdings-work', 'account', epoch])).toBeUndefined();
});

it('shows applications while notices are pending without declaring the unfinished section empty', async () => {
  pages = { 1: [application('draft')] };
  const original = get.getMockImplementation()!;
  let release!: (value: unknown) => void;
  get.mockImplementation((url, config) =>
    url === NOTICES
      ? new Promise((resolve) => {
          release = resolve;
        })
      : original(url, config),
  );
  const view = await render(<HomeScreen />, { wrapper });
  expect(await view.findByText('draft Company')).toBeTruthy();
  expect(view.getByText('Checking your notices…')).toBeTruthy();
  expect(view.queryByText('No applications or dividend records are in progress.')).toBeNull();
  await act(async () => release({ data: NOTHING }));
  expect(await view.findByText('No applications or dividend records are in progress.')).toBeTruthy();
});

it('removes cached application links after the investing role is removed and does not refetch them on pull', async () => {
  pages = { 1: [application('draft')] };
  const view = await render(<HomeScreen />, { wrapper });
  expect(await view.findByText('draft Company')).toBeTruthy();
  role = 'company';
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['userPreferences'] });
  });
  expect(await view.findByText('No votes need your attention.')).toBeTruthy();
  expect(view.queryByText('draft Company')).toBeNull();
  const applicationReads = get.mock.calls.filter(([url]) => url === APPLICATIONS).length;
  await act(async () => {
    (RefreshControl as unknown as { latestRef: { props: { onRefresh: () => void } } }).latestRef.props.onRefresh();
  });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(get.mock.calls.filter(([url]) => url === APPLICATIONS)).toHaveLength(applicationReads);
});

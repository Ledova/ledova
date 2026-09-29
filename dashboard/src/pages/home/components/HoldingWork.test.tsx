// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AxiosInstance } from 'axios';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ApiClientProvider,
  PUBLICATION_ENDPOINTS,
  SUBSCRIPTION_ENDPOINTS,
  USER_ACCOUNT_ENDPOINTS,
  formatDate,
  formatDateTime,
  type AccountRole,
  type PublicationSummary,
  type Subscription,
  type SubscriptionStatus,
} from '@ledova/shared';
import { HoldingWork } from './HoldingWork';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  useAuth: () => ({ isAuthenticated: true }),
}));

const NOTHING = { openResolutions: 0, nextClosesAt: null, dividendsWithoutRecord: 0 };
let client: QueryClient;
let role: AccountRole;
let summary: PublicationSummary;
let pages: Record<number, Subscription[]>;
let fail: string | undefined;
let next: (page: number) => string | null;
let published: Record<string, unknown>[];

function notice(n: number, overrides: Record<string, unknown> = {}) {
  return {
    uuid: `notice-${n}`,
    kind: 'meeting_notice',
    title: `Notice ${n}`,
    companyName: 'Harbour Example Pty Ltd',
    tokenName: 'Ordinary',
    createdAt: `2026-09-2${n}T00:00:00Z`,
    opensAt: null,
    closesAt: null,
    result: null,
    ...overrides,
  };
}

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
    walletAddress: '0x1111111111111111111111111111111111111111',
    createdAt: '2026-09-20T00:00:00Z',
    ...overrides,
  };
}

function section(title: string) {
  return within(screen.getByRole('heading', { name: title }).closest('section')!);
}

function show() {
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <MemoryRouter initialEntries={['/home']}>
          <Routes>
            <Route path="/home" element={<HoldingWork />} />
            <Route path="/subscriptions/:uuid" element={<p>Application details</p>} />
            <Route path="/publications" element={<p>Personal notices destination</p>} />
          </Routes>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  role = 'investor';
  summary = NOTHING;
  published = [];
  pages = { 1: [] };
  fail = undefined;
  next = (page) => (pages[page + 1] ? `https://example.test/api/v1/subscriptions/?page=${page + 1}` : null);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockImplementation(async (url: string, config?: { params?: { page?: number } }) => {
    if (fail === url || (fail === 'page2' && config?.params?.page === 2)) throw new Error('Unavailable');
    if (url === USER_ACCOUNT_ENDPOINTS.BASE) return { data: { uuid: 'account', role } };
    if (url === PUBLICATION_ENDPOINTS.SUMMARY) return { data: summary };
    if (url === PUBLICATION_ENDPOINTS.BASE) {
      return { data: { results: published, next: null, count: published.length, previous: null } };
    }
    if (url === SUBSCRIPTION_ENDPOINTS.BASE) {
      const page = config?.params?.page ?? 1;
      return {
        data: { results: pages[page], next: next(page), count: Object.values(pages).flat().length, previous: null },
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(() => {
  cleanup();
  client.clear();
});

it('separates actionable applications and votes from operator work and company payment records', async () => {
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
  summary = { openResolutions: 2, nextClosesAt: '2026-10-03T05:00:00Z', dividendsWithoutRecord: 1 };
  show();

  expect(await screen.findByText('draft Company')).toBeTruthy();
  expect(section('Needs you').getByText('awaiting_payment Company')).toBeTruthy();
  expect(section('Needs you').getByText('2 resolutions await your vote')).toBeTruthy();
  expect(section('Needs you').getByText(/^First closes /)).toBeTruthy();
  expect(section('In progress').getByText('Under review by the operator')).toBeTruthy();
  expect(section('In progress').getByText('Accepted, payment instruction next')).toBeTruthy();
  expect(section('In progress').getByText('Payment received, allotment next')).toBeTruthy();
  expect(section('In progress').getByText('1 dividend awaits a payment record from the company')).toBeTruthy();
  for (const status of ['allotted', 'rejected', 'withdrawn', 'refunded'])
    expect(screen.queryByText(`${status} Company`)).toBeNull();
  for (const status of ['draft', 'awaiting_payment'])
    expect(section('In progress').queryByText(`${status} Company`)).toBeNull();
  expect(section('Recently published to you').getByText('Nothing has been published to you yet.')).toBeTruthy();
  expect(screen.queryByText(/unread|unpaid/i)).toBeNull();
  expect(api.get.mock.calls.map(([url]) => url)).toEqual(
    expect.arrayContaining([PUBLICATION_ENDPOINTS.SUMMARY, SUBSCRIPTION_ENDPOINTS.BASE]),
  );
  expect(
    api.get.mock.calls.every(([url]) =>
      [
        PUBLICATION_ENDPOINTS.SUMMARY,
        PUBLICATION_ENDPOINTS.BASE,
        SUBSCRIPTION_ENDPOINTS.BASE,
        USER_ACCOUNT_ENDPOINTS.BASE,
      ].includes(url),
    ),
  ).toBe(true);
});

it('reads later application pages before asserting that nothing needs attention', async () => {
  pages = { 1: [application('allotted')], 2: [application('draft')] };
  show();
  expect(await screen.findByText('draft Company')).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith(SUBSCRIPTION_ENDPOINTS.BASE, { params: { page: 2 } });
  expect(screen.queryByText('No applications or votes need your attention.')).toBeNull();
});

it('links a partly funded application to its instruction without asking for the full amount again', async () => {
  pages = { 1: [application('awaiting_payment', { amountReceived: '249.50' })] };
  show();
  const link = await screen.findByRole('link', { name: 'View your payment instruction' });
  expect(link.getAttribute('href')).toBe('/subscriptions/awaiting_payment');
  expect(screen.queryByText(/250\.00|249\.50|Pay /)).toBeNull();
  fireEvent.click(link);
  expect(await screen.findByText('Application details')).toBeTruthy();
});

it('opens the existing Notices page for a vote rather than inventing a detail route', async () => {
  summary = { ...NOTHING, openResolutions: 1, nextClosesAt: '2026-10-03T05:00:00Z' };
  show();
  fireEvent.click(await screen.findByRole('link', { name: 'View notices to vote' }));
  expect(await screen.findByText('Personal notices destination')).toBeTruthy();
});

it.each<AccountRole>(['company', 'both'])(
  'keeps personal notices for %s and loads applications only when its routes are open',
  async (accountRole) => {
    role = accountRole;
    pages = { 1: [application('draft')] };
    summary = { ...NOTHING, openResolutions: 1, nextClosesAt: '2026-10-03T05:00:00Z' };
    show();
    expect(await screen.findByText('1 resolution awaits your vote')).toBeTruthy();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(api.get.mock.calls.some(([url]) => url === SUBSCRIPTION_ENDPOINTS.BASE)).toBe(accountRole === 'both');
    expect(screen.queryByText('draft Company') !== null).toBe(accountRole === 'both');
  },
);

it('waits for a known role before reading applications and does not treat pending data as empty', async () => {
  let finish!: (value: unknown) => void;
  const read = api.get.getMockImplementation()!;
  api.get.mockImplementation((url, config) =>
    url === USER_ACCOUNT_ENDPOINTS.BASE
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : read(url, config),
  );
  show();
  expect(await screen.findByText('Checking your applications…')).toBeTruthy();
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(PUBLICATION_ENDPOINTS.SUMMARY));
  expect(api.get.mock.calls.some(([url]) => url === SUBSCRIPTION_ENDPOINTS.BASE)).toBe(false);
  expect(screen.queryByText('No applications or votes need your attention.')).toBeNull();
  await act(async () => finish({ data: { uuid: 'account', role: 'company' } }));
  expect(await screen.findByText('No votes need your attention.')).toBeTruthy();
  expect(api.get.mock.calls.some(([url]) => url === SUBSCRIPTION_ENDPOINTS.BASE)).toBe(false);
});

it.each([USER_ACCOUNT_ENDPOINTS.BASE, SUBSCRIPTION_ENDPOINTS.BASE, 'page2'])(
  'keeps notices available and offers an independent retry when %s fails',
  async (failure) => {
    fail = failure;
    pages = { 1: [application('draft')], 2: [application('paid')] };
    summary = { ...NOTHING, openResolutions: 1, nextClosesAt: '2026-10-03T05:00:00Z' };
    show();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View notices to vote' })).toBeTruthy();
    expect(screen.queryByText('draft Company')).toBeNull();
    expect(screen.queryByText('No applications or dividend records are in progress.')).toBeNull();
    const noticeReads = api.get.mock.calls.filter(([url]) => url === PUBLICATION_ENDPOINTS.SUMMARY).length;
    fail = undefined;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('draft Company')).toBeTruthy();
    expect(screen.getByText('paid Company')).toBeTruthy();
    expect(api.get.mock.calls.filter(([url]) => url === PUBLICATION_ENDPOINTS.SUMMARY)).toHaveLength(noticeReads);
  },
);

it('keeps application links available while a failed notice source is retried independently', async () => {
  fail = PUBLICATION_ENDPOINTS.SUMMARY;
  pages = { 1: [application('draft')] };
  show();
  expect(await screen.findByText('draft Company')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain("We couldn't check your notices.");
  expect(screen.queryByText('No applications or dividend records are in progress.')).toBeNull();
  const applicationReads = api.get.mock.calls.filter(([url]) => url === SUBSCRIPTION_ENDPOINTS.BASE).length;
  fail = undefined;
  summary = { ...NOTHING, dividendsWithoutRecord: 2 };
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('2 dividends await a payment record from the company')).toBeTruthy();
  expect(api.get.mock.calls.filter(([url]) => url === SUBSCRIPTION_ENDPOINTS.BASE)).toHaveLength(applicationReads);
});

it('keeps application work visible while notices are still loading without declaring the other section empty', async () => {
  pages = { 1: [application('draft')] };
  let finish!: (value: unknown) => void;
  const read = api.get.getMockImplementation()!;
  api.get.mockImplementation((url, config) =>
    url === PUBLICATION_ENDPOINTS.SUMMARY
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : read(url, config),
  );
  show();
  expect(await screen.findByText('draft Company')).toBeTruthy();
  expect(screen.getByText('Checking your notices…')).toBeTruthy();
  expect(screen.queryByText('No applications or dividend records are in progress.')).toBeNull();
  await act(async () => finish({ data: NOTHING }));
  expect(await screen.findByText('No applications or dividend records are in progress.')).toBeTruthy();
});

it('does not present cached application work as current after a later page fails on refresh', async () => {
  pages = { 1: [application('draft')], 2: [application('paid')] };
  show();
  expect(await screen.findByText('draft Company')).toBeTruthy();
  fail = 'page2';
  await act(async () => client.invalidateQueries({ queryKey: ['subscriptions'] }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('draft Company')).toBeNull();
  expect(screen.queryByText('paid Company')).toBeNull();
  expect(screen.queryByText('No applications or votes need your attention.')).toBeNull();
});

it.each([
  'https://example.test/api/v1/subscriptions/?page=1',
  'https://example.test/api/v1/subscriptions/?page=1.5',
  'https://example.test/api/v1/subscriptions/',
])('refuses malformed or nonadvancing pagination %s', async (badNext) => {
  pages = { 1: [application('draft')] };
  next = () => badNext;
  show();
  expect((await screen.findByRole('alert')).textContent).toContain("We couldn't load all your applications.");
  expect(screen.queryByText('draft Company')).toBeNull();
  expect(api.get.mock.calls.filter(([url]) => url === SUBSCRIPTION_ENDPOINTS.BASE)).toHaveLength(1);
});

it('updates work when existing application mutations invalidate their query prefix', async () => {
  pages = { 1: [application('draft')] };
  show();
  expect(await screen.findByText('Review and submit your draft')).toBeTruthy();
  pages = { 1: [application('submitted')] };
  await act(async () => client.invalidateQueries({ queryKey: ['subscriptions'] }));
  expect(await screen.findByText('Under review by the operator')).toBeTruthy();
  expect(screen.queryByText('Review and submit your draft')).toBeNull();
});

it('lists the three latest notices addressed to you, and asks only for your own', async () => {
  published = [notice(4, { kind: 'distribution' }), notice(3), notice(2), notice(1)];
  show();

  const recent = section('Recently published to you');
  expect(await recent.findByText('Notice 4')).toBeTruthy();
  expect(recent.getByText('Harbour Example Pty Ltd · Dividend')).toBeTruthy();
  expect(recent.getAllByText('Harbour Example Pty Ltd · Meeting notice')).toHaveLength(2);
  expect(recent.getAllByRole('listitem').map((item) => item.querySelector('p + p')?.textContent)).toEqual([
    'Notice 4',
    'Notice 3',
    'Notice 2',
  ]);
  expect(api.get).toHaveBeenCalledWith(PUBLICATION_ENDPOINTS.BASE, { params: { page: 1, addressed: 'me' } });
  fireEvent.click(recent.getByRole('link', { name: 'View all notices' }));
  expect(await screen.findByText('Personal notices destination')).toBeTruthy();
});

it('names the company, kind and date of each notice, and says until when a vote is open', async () => {
  const hour = 3_600_000;
  const now = Date.now();
  const at = (hours: number) => new Date(now + hours * hour).toISOString();
  published = [
    notice(3, { kind: 'resolution', opensAt: at(-24), closesAt: at(24) }),
    notice(2, { kind: 'resolution', opensAt: at(24), closesAt: at(48) }),
    notice(1, { kind: 'resolution', opensAt: at(-24), closesAt: at(-1) }),
  ];
  show();

  const recent = section('Recently published to you');
  expect(await recent.findByText('Notice 3')).toBeTruthy();
  const [open, upcoming, closed] = recent.getAllByRole('listitem').map((item) => within(item));
  expect(open.getByText('Harbour Example Pty Ltd · Resolution')).toBeTruthy();
  expect(open.getByText(`Open until ${formatDateTime(at(24))}`)).toBeTruthy();
  expect(open.getByText(formatDate('2026-09-23T00:00:00Z'))).toBeTruthy();
  for (const row of [upcoming, closed]) {
    expect(row.getByText('Harbour Example Pty Ltd · Resolution')).toBeTruthy();
    expect(row.queryByText(/Open until/)).toBeNull();
  }
});

it('says it is checking while the latest notices load, and never calls a failed read empty', async () => {
  let release!: () => void;
  let requests = 0;
  const original = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string, config?: { params?: { page?: number } }) => {
    if (url !== PUBLICATION_ENDPOINTS.BASE) return original(url, config);
    requests += 1;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    if (fail === url) throw new Error('Unavailable');
    return { data: { results: published, next: null, count: published.length, previous: null } };
  });
  fail = PUBLICATION_ENDPOINTS.BASE;
  show();

  const recent = section('Recently published to you');
  expect(await recent.findByText('Checking what was published to you…')).toBeTruthy();
  expect(recent.queryByText('Nothing has been published to you yet.')).toBeNull();
  await act(async () => release());
  expect(await recent.findByText("We couldn't load what was published to you.")).toBeTruthy();
  expect(recent.queryByText('Nothing has been published to you yet.')).toBeNull();
  fail = undefined;
  published = [notice(1)];
  fireEvent.click(recent.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(requests).toBe(2));
  await act(async () => release());
  expect(await recent.findByText('Notice 1')).toBeTruthy();
});

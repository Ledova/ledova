// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SUBSCRIPTION_COPY, SUBSCRIPTION_ENDPOINTS } from '@ledova/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

import SubscriptionDetailPage from './detail';

const application = {
  uuid: 'application-1',
  offeringUuid: 'offering-1',
  tokenSymbol: 'KFA',
  tokenName: 'Class A preference',
  companyName: 'Kestrel Foods Pty Ltd',
  status: 'paid',
  statusDisplay: 'Paid',
  quantity: 1200,
  allottedQuantity: 1200,
  pricePerShare: '1.50',
  amountDue: '1800.00',
  amountReceived: '1800.00',
  currency: 'AUD',
  settlementRail: 'bank_transfer',
  settlementRailDisplay: 'Bank transfer',
  reference: 'PAY1A2B3C4D',
  paymentDueAt: '2026-09-30T00:00:00Z',
  walletAddress: `0x${'4'.repeat(40)}`,
  createdAt: '2026-09-20T01:00:00Z',
  submittedAt: '2026-09-20T02:00:00Z',
  acceptedAt: '2026-09-21T03:00:00Z',
  paymentInstructionIssuedAt: '2026-09-21T03:05:00Z',
  paymentReceivedOn: '2026-09-23',
  allottedAt: null,
  refundedAt: null,
  closedAt: null,
  refundAmount: null,
  paymentInstruction: null,
  updatedAt: '2026-09-23T04:00:00Z',
};

let client: QueryClient;

function show(overrides: Record<string, unknown> = {}) {
  api.get.mockResolvedValue({ data: { ...application, ...overrides } });
  renderPage();
}

function renderPage() {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/subscriptions/application-1']}>
        <Routes>
          <Route path="/subscriptions/:uuid" element={<SubscriptionDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const aud = (figures: string) => `AUD\u00a0${figures}`;

function row(label: string) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.resetAllMocks();
});

it('states each figure as a whole-share count or an amount that names its currency', async () => {
  show();

  expect(await screen.findByText('Kestrel Foods Pty Ltd · Class A preference')).toBeTruthy();
  expect(row('Status')).toBe('Payment received, allotment next');
  expect(row('Shares applied for')).toBe('1,200');
  expect(row('Price per share')).toBe(aud('1.50'));
  expect(row('Amount due')).toBe(aud('1,800.00'));
  expect(row('Amount received')).toBe(aud('1,800.00'));
  expect(row('Payment reference')).toBe('PAY1A2B3C4D');
});

it('lists recorded events in workflow step order, each with its date, and what happens next', async () => {
  show();

  const localDate = (instant: string) =>
    new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(instant));
  const history = (await screen.findByText('History')).closest('section')!;
  expect(
    within(history)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual([
    `Drafted${localDate(application.createdAt)}`,
    `Submitted for review${localDate(application.submittedAt)}`,
    `Accepted by the operator${localDate(application.acceptedAt)}`,
    `Payment instruction issued${localDate(application.paymentInstructionIssuedAt)}`,
    'Payment received23 September 2026',
  ]);
  expect(within(history).getByText(/^Next: /)).toBeTruthy();
});

it('keeps a payment received on the day its instruction was issued after the instruction', async () => {
  show({ paymentInstructionIssuedAt: '2026-09-23T01:00:00Z', paymentReceivedOn: '2026-09-23' });

  const history = (await screen.findByText('History')).closest('section')!;
  expect(
    within(history)
      .getAllByRole('listitem')
      .map((item) => item.firstElementChild?.nextElementSibling?.textContent)
      .slice(-2),
  ).toEqual(['Payment instruction issued', 'Payment received']);
});

it('leaves out a step whose date was never recorded, rather than guessing one', async () => {
  show({ submittedAt: null, acceptedAt: null });

  const history = (await screen.findByText('History')).closest('section')!;
  expect(
    within(history)
      .getAllByRole('listitem')
      .map((item) => item.firstElementChild?.nextElementSibling?.textContent),
  ).toEqual(['Drafted', 'Payment instruction issued', 'Payment received']);
});

it.each([
  ['Submit for review', SUBSCRIPTION_ENDPOINTS.SUBMIT('application-1'), {}],
  ['Withdraw', SUBSCRIPTION_ENDPOINTS.WITHDRAW('application-1'), { reason: 'Withdrawn by the investor' }],
])('offers %s on a draft, and sends it where it says', async (label, endpoint, body) => {
  api.post.mockResolvedValue({ data: {} });
  show({ status: 'draft', statusDisplay: 'Draft', amountReceived: null, paymentReceivedOn: null });

  fireEvent.click(await screen.findByRole('button', { name: label }));

  await waitFor(() => expect(api.post).toHaveBeenCalledWith(endpoint, body));
  expect(api.post).toHaveBeenCalledOnce();
});

it('offers neither action once money has been received', async () => {
  show({ status: 'awaiting_payment', statusDisplay: 'Awaiting payment', amountReceived: '1800.00' });

  await screen.findByText('Kestrel Foods Pty Ltd · Class A preference');
  expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
});

it.each([
  ['draft', 'Draft'],
  ['submitted', 'Under review by the operator'],
  ['accepted', 'Accepted, payment instruction next'],
  ['awaiting_payment', 'Awaiting your payment'],
  ['paid', 'Payment received, allotment next'],
  ['allotted', 'Shares allotted'],
  ['rejected', 'Rejected'],
  ['withdrawn', 'Withdrawn'],
  ['refunded', 'Refunded'],
])('says what a %s application is doing, in words', async (status, words) => {
  show({ status });

  await screen.findByText('Kestrel Foods Pty Ltd · Class A preference');
  expect(row('Status')).toBe(words);
});

it.each([
  ['awaiting_payment', true],
  ['paid', true],
  ['allotted', false],
  ['refunded', false],
  ['withdrawn', false],
  ['rejected', false],
])('says money in blocks a withdrawal only while the money is held: %s', async (status, shown) => {
  show({ status });

  await screen.findByText('Kestrel Foods Pty Ltd · Class A preference');
  expect(screen.queryByText(SUBSCRIPTION_COPY.MONEY_IN_HELP) !== null).toBe(shown);
});

it('distinguishes a server failure from a genuinely unavailable application and retries', async () => {
  api.get.mockRejectedValue({ response: { status: 500 } });
  renderPage();
  expect(await screen.findByText('This application could not be loaded. Try again before continuing.')).toBeTruthy();
  expect(screen.queryByText('Not available')).toBeNull();
  api.get.mockResolvedValue({ data: application });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Kestrel Foods Pty Ltd · Class A preference')).toBeTruthy();
});

it('gives a real 404 its own unavailable state and a route back to applications', async () => {
  api.get.mockRejectedValue({ response: { status: 404 } });
  renderPage();
  expect(await screen.findByText('Not available')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'All applications' }).getAttribute('href')).toBe('/subscriptions');
  expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull();
});

it('suppresses stale amounts, payment instructions and actions when the application refresh fails', async () => {
  show({ status: 'draft', amountReceived: null });
  await screen.findByRole('button', { name: 'Submit for review' });
  api.get.mockRejectedValue({ response: { status: 503 } });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['subscriptions'] });
  });
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Amount due')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
});

it.each(['Submit for review', 'Withdraw'])('keeps a refused %s request visible and permits retry', async (label) => {
  api.post
    .mockRejectedValueOnce({ response: { data: { detail: 'Please update your evidence.' } } })
    .mockResolvedValue({ data: {} });
  show({ status: 'draft', amountReceived: null });
  fireEvent.click(await screen.findByRole('button', { name: label }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Please update your evidence.');
  fireEvent.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

it('keeps both actions disabled through submission and the subsequent state refresh', async () => {
  let finishPost!: (value: { data: object }) => void;
  let finishRead!: (value: { data: object }) => void;
  api.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishPost = resolve;
      }),
  );
  show({ status: 'draft', amountReceived: null });
  fireEvent.click(await screen.findByRole('button', { name: 'Submit for review' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Withdraw' })).toHaveProperty('disabled', true));
  fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
  expect(api.post).toHaveBeenCalledTimes(1);
  api.get.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  );
  await act(async () => finishPost({ data: {} }));
  await waitFor(() => expect(finishRead).toBeTypeOf('function'));
  expect(screen.getByRole('button', { name: 'Submit for review' })).toHaveProperty('disabled', true);
  await act(async () => finishRead({ data: { ...application, status: 'submitted', amountReceived: null } }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull());
  expect(row('Status')).toBe('Under review by the operator');
});

it('does not treat a recorded zero amount as money held', async () => {
  show({ status: 'awaiting_payment', amountReceived: '0.00' });
  expect(await screen.findByRole('button', { name: 'Withdraw' })).toBeTruthy();
  expect(screen.queryByText(SUBSCRIPTION_COPY.MONEY_IN_HELP)).toBeNull();
});

it('shows outstanding money separately without changing a partially paid original instruction', async () => {
  show({
    status: 'awaiting_payment',
    amountReceived: '300.00',
    amountOutstanding: '1500.00',
    paymentInstruction: {
      rail: 'bank_transfer',
      railDisplay: 'Bank transfer',
      reference: 'PAY1A2B3C4D',
      amountDue: '1800.00',
      currency: 'AUD',
      payee: 'Example Registry',
      issuedAt: null,
      paymentDueAt: null,
      bankAccountName: 'Example Trust',
      bankBsb: '001-002',
      bankAccountNumber: '00012345',
    },
  });
  expect(await screen.findByText(/A payment has already been recorded/)).toBeTruthy();
  expect(row('Amount outstanding')).toBe(aud('1,500.00'));
  expect(screen.getByText('Amount on instruction').nextElementSibling?.textContent).toContain(aud('1,800.00'));
  expect(screen.queryByText(SUBSCRIPTION_COPY.AWAITING_PAYMENT_HELP)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
});

it('does not invent payment rails when the authoritative instruction is unavailable', async () => {
  show({ status: 'awaiting_payment', paymentInstruction: null, amountReceived: null });
  expect(await screen.findByText('Payment instruction unavailable')).toBeTruthy();
  expect(screen.queryByText('Account number')).toBeNull();
});

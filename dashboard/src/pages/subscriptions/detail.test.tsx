// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

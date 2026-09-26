// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

it('lists what has happened in the order it happened, each with its date, and what happens next', async () => {
  show();

  const history = (await screen.findByText('History')).closest('section')!;
  expect(
    within(history)
      .getAllByRole('listitem')
      .map((item) => item.textContent),
  ).toEqual([
    'Drafted20 September 2026',
    'Submitted for review20 September 2026',
    'Accepted by the operator21 September 2026',
    'Payment instruction issued21 September 2026',
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

it('offers Submit for review and Withdraw on a draft, and submits it', async () => {
  api.post.mockResolvedValue({ data: {} });
  show({ status: 'draft', statusDisplay: 'Draft', amountReceived: null, paymentReceivedOn: null });

  fireEvent.click(await screen.findByRole('button', { name: 'Submit for review' }));

  expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
});

it('offers neither action once money has been received', async () => {
  show();

  await screen.findByText('Kestrel Foods Pty Ltd · Class A preference');
  expect(screen.queryByRole('button', { name: 'Submit for review' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
});

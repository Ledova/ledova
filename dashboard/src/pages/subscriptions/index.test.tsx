// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AxiosInstance } from 'axios';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiClientProvider, SUBSCRIPTION_ENDPOINTS, type Subscription } from '@ledova/shared';
import { PageTitle } from '@components/PageTitle';
import SubscriptionsPage from './index';

const api = { get: vi.fn() };
let client: QueryClient;
const application: Subscription = {
  uuid: 'application-one',
  offeringUuid: 'hidden-offering',
  tokenSymbol: 'ORD',
  tokenName: 'Recorded ordinary shares',
  companyName: 'Recorded Harbour Example Pty Ltd',
  status: 'awaiting_payment',
  statusDisplay: 'Awaiting payment',
  quantity: 2000,
  allottedQuantity: null,
  pricePerShare: '1.25',
  amountDue: '2500.00',
  amountReceived: null,
  currency: 'AUD',
  settlementRail: 'bank_transfer',
  settlementRailDisplay: 'Bank transfer',
  reference: 'EXAMPLE0123',
  paymentDueAt: '2026-10-01T00:00:00Z',
  walletAddress: `0x${'1'.repeat(40)}`,
  createdAt: '2026-09-20T01:00:00Z',
};
const next = 'https://example.invalid/api/v1/subscriptions/?page=2';
function page(results: Subscription[] = [application], next: string | null = null) {
  return { data: { results, next, count: results.length, previous: null } };
}
function show() {
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ApiClientProvider client={api as unknown as AxiosInstance}>
          <PageTitle.Provider value="Applications">
            <SubscriptionsPage />
          </PageTitle.Provider>
        </ApiClientProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockResolvedValue(page());
});
afterEach(() => {
  cleanup();
  client.clear();
});

it('waits for applications without claiming that the list is empty', async () => {
  let finish!: (value: ReturnType<typeof page>) => void;
  api.get.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show();
  expect(screen.getByRole('status')).toBeTruthy();
  expect(screen.queryByText('No applications yet.')).toBeNull();
  await act(async () => finish(page()));
  expect(await screen.findByRole('article')).toBeTruthy();
});

it('shows recorded identities and currency without a current Directory read, including further pages', async () => {
  api.get.mockImplementation(async (_url: string, config?: { params: { page: number } }) =>
    config?.params.page === 1
      ? page([application], next)
      : page([
          {
            ...application,
            uuid: 'application-two',
            companyName: 'Earlier recorded issuer',
            currency: 'NZD',
            status: 'withdrawn',
            reference: '',
          },
        ]),
  );
  show();
  expect(
    await screen.findByRole('heading', { name: 'Recorded Harbour Example Pty Ltd · Recorded ordinary shares' }),
  ).toBeTruthy();
  const first = screen.getByRole('article');
  expect(within(first).getByText('2,000')).toBeTruthy();
  expect(within(first).getByText(/AUD\s2,500.00/)).toBeTruthy();
  expect(within(first).getByText(/AUD\s1.25/)).toBeTruthy();
  expect(within(first).getByText('EXAMPLE0123')).toBeTruthy();
  expect(within(first).getByRole('link', { name: 'Application' }).getAttribute('href')).toBe(
    '/subscriptions/application-one',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Load more applications' }));
  expect(await screen.findByText(/NZD\s2,500.00/)).toBeTruthy();
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Load more applications' })).toBeNull();
  expect(api.get).toHaveBeenCalledWith(SUBSCRIPTION_ENDPOINTS.BASE, { params: { page: 2 } });
  expect(api.get.mock.calls.every(([url]) => url === SUBSCRIPTION_ENDPOINTS.BASE)).toBe(true);
});

it('shows an empty state only after a successful complete empty response', async () => {
  api.get.mockResolvedValue(page([]));
  show();
  expect(await screen.findByText('No applications yet.')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2, name: 'Your applications' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Directory' }).getAttribute('href')).toBe('/directory');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('reports an initial failure and retries instead of claiming there are no applications', async () => {
  api.get.mockRejectedValueOnce(Error('Unavailable')).mockResolvedValue(page());
  show();
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Your applications could not be loaded. Try again before continuing.Try again',
  );
  expect(screen.queryByText('No applications yet.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('article')).toBeTruthy();
});

it('keeps known applications visible when a later page fails, then retries that page', async () => {
  let broken = true;
  api.get.mockImplementation(async (_url: string, config?: { params: { page: number } }) => {
    if (config?.params.page === 1) return page([application], next);
    if (broken) throw Error('Unavailable');
    return page([{ ...application, uuid: 'earlier' }]);
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more applications' }));
  expect(await screen.findByText('More applications could not be loaded. The list is incomplete.')).toBeTruthy();
  expect(screen.getAllByRole('article')).toHaveLength(1);
  broken = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try more applications again' }));
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
  expect(api.get).toHaveBeenLastCalledWith(SUBSCRIPTION_ENDPOINTS.BASE, { params: { page: 2 } });
});

it('holds Load more while the list is read again, then offers the next page', async () => {
  api.get.mockResolvedValue(page([application], next));
  show();
  expect(await screen.findByRole('button', { name: 'Load more applications' })).toHaveProperty('disabled', false);
  let finish!: (value: ReturnType<typeof page>) => void;
  api.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let refreshing!: Promise<void>;
  act(() => {
    refreshing = client.invalidateQueries({ queryKey: ['subscriptions'] });
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Load more applications' })).toHaveProperty('disabled', true),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Load more applications' }));
  expect(api.get.mock.calls.map(([, config]) => config.params.page)).toEqual([1, 1]);
  await act(async () => {
    finish(page([application], next));
    await refreshing;
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Load more applications' })).toHaveProperty('disabled', false),
  );
});

it('keeps applications and the later-page failure on screen while the list is read again', async () => {
  api.get.mockImplementation(async (_url: string, config?: { params: { page: number } }) => {
    if (config?.params.page === 1) return page([application], next);
    throw Error('Unavailable');
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more applications' }));
  expect(await screen.findByText('More applications could not be loaded. The list is incomplete.')).toBeTruthy();
  let finish!: (value: ReturnType<typeof page>) => void;
  api.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let refreshing!: Promise<void>;
  act(() => {
    refreshing = client.invalidateQueries({ queryKey: ['subscriptions'] });
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Try more applications again' })).toHaveProperty('disabled', true),
  );
  expect(screen.getByRole('article')).toBeTruthy();
  expect(screen.queryByText('Your applications could not be loaded. Try again before continuing.')).toBeNull();
  await act(async () => {
    finish(page([application, { ...application, uuid: 'application-two' }], next));
    await refreshing;
  });
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
  expect(screen.getByRole('button', { name: 'Load more applications' })).toHaveProperty('disabled', false);
});

it('does not call an empty page complete when the next page remains unread or fails', async () => {
  api.get.mockImplementation(async (_url: string, config?: { params: { page: number } }) => {
    if (config?.params.page === 1) return page([], next);
    throw Error('Unavailable');
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Load more applications' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('No applications yet.')).toBeNull();
});

it('hides stale application values and links after refresh failure until a successful retry', async () => {
  show();
  await screen.findByRole('article');
  api.get.mockRejectedValue(Error('Unavailable'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['subscriptions'] });
  });
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('article')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Application' })).toBeNull();
  api.get.mockResolvedValue(page());
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('article')).toBeTruthy();
});

it('refuses a nonadvancing next link', async () => {
  api.get.mockResolvedValue(page([application], 'https://example.invalid/api/v1/subscriptions/?page=1'));
  show();
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Your applications could not be loaded. Try again before continuing.',
  );
  expect(screen.queryByRole('article')).toBeNull();
  expect(api.get).toHaveBeenCalledTimes(1);
});

it('does not report a rounded numeric quantity as an exact share count', async () => {
  api.get.mockResolvedValue(page([{ ...application, quantity: 9007199254740992 }]));
  show();
  expect(await screen.findByText('Unavailable')).toBeTruthy();
  expect(screen.queryByText('9,007,199,254,740,992')).toBeNull();
});

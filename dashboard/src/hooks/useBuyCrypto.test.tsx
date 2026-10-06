// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AccountRole } from '@ledova/shared';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const preferences = vi.hoisted(() => ({
  account: { uuid: 'owner', role: 'investor' } as { uuid: string; role: AccountRole } | null,
}));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@ledova/shared', async (original) => ({
  ...(await original<typeof import('@ledova/shared')>()),
  useUserPreferences: () => ({ userAccount: preferences.account }),
  useCurrency: () => ({ exchangeRate: 1, formatDisplayCurrency: String }),
}));

import { BuyCryptoProvider, useBuyCrypto } from './useBuyCrypto';

let client: QueryClient;

function Entry() {
  const { openBuyCrypto, canBuyCrypto } = useBuyCrypto();
  return (
    <>
      {canBuyCrypto && <span>Investor purchase available</span>}
      <button onClick={openBuyCrypto}>Direct purchase entry</button>
    </>
  );
}

function app() {
  return (
    <QueryClientProvider client={client}>
      <BuyCryptoProvider>
        <Entry />
      </BuyCryptoProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  preferences.account = { uuid: 'owner', role: 'investor' };
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.get.mockImplementation(async (url: string) => ({
    data: {
      results:
        url === '/api/wallets/'
          ? [
              {
                uuid: 'wallet',
                userAccount: 'owner',
                name: 'Fictional receiving wallet',
                chain: 'ethereum',
                verificationStatus: 'VERIFIED',
              },
            ]
          : [],
      count: url === '/api/wallets/' ? 1 : 0,
      next: null,
      previous: null,
    },
  }));
  api.post.mockResolvedValue({ data: { url: 'https://global.transak.com/synthetic' } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
});

it.each(['investor', 'both'] as const)('opens optional purchasing for a known %s account', async (role) => {
  preferences.account = { uuid: 'owner', role };
  render(app());
  fireEvent.click(screen.getByText('Direct purchase entry'));
  expect(await screen.findByText('Select an asset to purchase')).toBeTruthy();
  fireEvent.click(screen.getByText('Ethereum'));
  expect(await screen.findByTitle('Buy Digital Assets')).toHaveProperty('src', 'https://global.transak.com/synthetic');
  expect(api.post).toHaveBeenCalledOnce();
});

it.each(['company', 'missing'] as const)('refuses direct purchase entry for a %s account', async (kind) => {
  preferences.account = kind === 'company' ? { uuid: 'owner', role: 'company' } : null;
  render(app());
  fireEvent.click(screen.getByText('Direct purchase entry'));
  await act(() => Promise.resolve());
  expect(screen.queryByText('Investor purchase available')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});

it.each(['company', 'missing', 'different'] as const)(
  'drops a deferred provider URL after account authority changes to %s',
  async (kind) => {
    let respond!: (value: { data: { url: string } }) => void;
    api.post.mockReturnValue(
      new Promise((resolve) => {
        respond = resolve;
      }),
    );
    const view = render(app());
    fireEvent.click(screen.getByText('Direct purchase entry'));
    fireEvent.click(await screen.findByText('Ethereum'));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    preferences.account =
      kind === 'missing'
        ? null
        : { uuid: kind === 'different' ? 'new-owner' : 'owner', role: kind === 'company' ? 'company' : 'investor' };
    view.rerender(app());
    await act(() => respond({ data: { url: 'https://global.transak.com/retired' } }));
    expect(screen.queryByTitle('Buy Digital Assets')).toBeNull();
    preferences.account = { uuid: 'owner', role: 'investor' };
    view.rerender(app());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.post).toHaveBeenCalledOnce();
  },
);

it('refuses a provider response after cancellation and reopening', async () => {
  let respond!: (value: { data: { url: string } }) => void;
  api.post.mockReturnValue(
    new Promise((resolve) => {
      respond = resolve;
    }),
  );
  render(app());
  fireEvent.click(screen.getByText('Direct purchase entry'));
  fireEvent.click(await screen.findByText('Ethereum'));
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByText('Direct purchase entry'));
  await act(() => respond({ data: { url: 'https://global.transak.com/cancelled' } }));
  expect(screen.queryByTitle('Buy Digital Assets')).toBeNull();
  expect(screen.getByText('Select an asset to purchase')).toBeTruthy();
});

it.each(['company', 'missing', 'different'] as const)(
  'removes an open provider and keeps its callbacks retired after account loss to %s',
  async (kind) => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const view = render(app());
    fireEvent.click(screen.getByText('Direct purchase entry'));
    fireEvent.click(await screen.findByText('Ethereum'));
    await screen.findByTitle('Buy Digital Assets');
    preferences.account =
      kind === 'missing'
        ? null
        : { uuid: kind === 'different' ? 'new-owner' : 'owner', role: kind === 'company' ? 'company' : 'investor' };
    view.rerender(app());
    expect(screen.queryByTitle('Buy Digital Assets')).toBeNull();
    preferences.account = { uuid: 'owner', role: 'investor' };
    view.rerender(app());
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://global.transak.com',
        data: { event_id: 'TRANSAK_ORDER_SUCCESSFUL' },
      }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(invalidate).not.toHaveBeenCalled();
  },
);

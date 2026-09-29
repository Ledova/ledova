// @vitest-environment jsdom

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ASSET_ENDPOINTS, WALLET_ENDPOINTS } from '@ledova/shared';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const currency = vi.hoisted(() => ({ rate: 2 }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  useCurrency: () => ({
    exchangeRate: currency.rate,
    formatDisplayCurrency: (value: number) => `A$${value * currency.rate}`,
  }),
}));

import { BuyCryptoModal } from './BuyCryptoModal';

const wallet = (uuid: string, name: string) => ({
  uuid,
  name,
  address: `0x${'4'.repeat(40)}`,
  chain: 'ethereum',
  verificationStatus: 'VERIFIED',
  nativeBalance: '1',
  marketValue: '1',
});
let client: QueryClient;

function Provider({ onNavigateToWidget }: { onNavigateToWidget: (url: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <BuyCryptoModal
      isOpen={open}
      onClose={() => setOpen(false)}
      onNavigateToWidget={(url) => {
        setOpen(false);
        onNavigateToWidget(url);
      }}
      userAccountUuid="synthetic-account"
    />
  );
}

function Reopenable({ onNavigateToWidget }: { onNavigateToWidget: (url: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Buy again
      </button>
      <BuyCryptoModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onNavigateToWidget={(url) => {
          setOpen(false);
          onNavigateToWidget(url);
        }}
        userAccountUuid="synthetic-account"
      />
    </>
  );
}

async function boughtOnceThenAgain(navigate: (url: string) => void, next: () => Promise<unknown>) {
  answer([wallet('wallet-1', 'First wallet')]);
  render(
    <QueryClientProvider client={client}>
      <Reopenable onNavigateToWidget={navigate} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText('Ethereum'));
  await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const prices = api.get.getMockImplementation()!;
  api.get.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) =>
    url === WALLET_ENDPOINTS.BASE ? next() : prices(url, config),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Buy again' }));
  fireEvent.click(await screen.findByText('Ethereum'));
  await waitFor(() => expect(walletCalls()).toHaveLength(2));
}

function pending<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle: (value: T) => act(async () => settle(value)) };
}

function show(props: { onNavigateToWidget?: (url: string) => void }) {
  return render(
    <QueryClientProvider client={client}>
      <Provider onNavigateToWidget={props.onNavigateToWidget ?? (() => {})} />
    </QueryClientProvider>,
  );
}

function closedThenOpen(isOpen: boolean) {
  return (
    <QueryClientProvider client={client}>
      <BuyCryptoModal
        isOpen={isOpen}
        onClose={() => {}}
        onNavigateToWidget={() => {}}
        userAccountUuid="synthetic-account"
      />
    </QueryClientProvider>
  );
}

function page<T>(results: T[]) {
  return { data: { results, count: results.length, next: null, previous: null } };
}

const PRICES: Record<string, string | null> = { BTC: '98000', ETH: '3500', USDC: '1', USDT: null };

function answer(wallets: ReturnType<typeof wallet>[]) {
  api.get.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === ASSET_ENDPOINTS.BASE) {
      const symbol = String(config?.params?.symbol);
      const price = PRICES[symbol];
      return Promise.resolve(page(price === null ? [] : [{ uuid: symbol, symbol, currentPrice: price }]));
    }
    if (url === WALLET_ENDPOINTS.BASE) return Promise.resolve(page(wallets));
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

const walletCalls = () => api.get.mock.calls.filter(([url]) => url === WALLET_ENDPOINTS.BASE);
const priceCalls = () => api.get.mock.calls.filter(([url]) => url === ASSET_ENDPOINTS.BASE);
const assetRows = () =>
  ['Bitcoin', 'Ethereum', 'USD Coin', 'Tether'].map((name) => screen.getByText(name).closest('button')?.textContent);

beforeEach(() => {
  currency.rate = 2;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.post.mockResolvedValue({ data: { url: 'https://onramp.example.test/widget' } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.resetAllMocks();
});

it("shows each asset's current price in AUD, and none for an asset without a price", async () => {
  answer([]);
  show({});

  expect(await screen.findByText('A$196000')).toBeTruthy();
  expect(screen.getByRole('dialog', { name: 'Buy crypto' })).toBeTruthy();
  expect(screen.getByText('Bitcoin').closest('button')!.parentElement!.className).toContain('divide-y');
  expect(assetRows()).toEqual(['BitcoinA$196000', 'EthereumA$7000', 'USD CoinA$2', 'Tether']);
  expect(priceCalls().map(([, config]) => config.params)).toEqual(
    ['BTC', 'ETH', 'USDC', 'USDT'].map((symbol) => ({ symbol, is_active: true })),
  );
});

it('shows no price while the exchange rate is unknown, rather than a dash per asset', async () => {
  currency.rate = 0;
  answer([]);
  show({});

  await waitFor(() => expect(priceCalls()).toHaveLength(4));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(assetRows()).toEqual(['Bitcoin', 'Ethereum', 'USD Coin', 'Tether']);
});

it('asks for no price until the flow opens, since the frame mounts it on every page', async () => {
  answer([]);
  const view = render(closedThenOpen(false));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(priceCalls()).toHaveLength(0);

  view.rerender(closedThenOpen(true));
  expect(await screen.findByText('A$196000')).toBeTruthy();
});

it('goes straight to the widget for the only verified wallet of the chosen asset', async () => {
  answer([wallet('wallet-1', 'Only wallet')]);
  const navigate = vi.fn();
  show({ onNavigateToWidget: navigate });
  fireEvent.click(screen.getByText('Ethereum'));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('https://onramp.example.test/widget'));
  expect(walletCalls()[0][1]).toEqual({
    params: { chain: 'ethereum', verification_status: 'VERIFIED', ordering: 'signing_preference' },
  });
  expect(api.post).toHaveBeenCalledOnce();
  expect(api.post.mock.calls[0][1]).toMatchObject({ wallet_uuid: 'wallet-1' });
});

it('asks which wallet receives the chosen asset when several match', async () => {
  answer([wallet('wallet-1', 'First wallet'), wallet('wallet-2', 'Second wallet')]);
  const navigate = vi.fn();
  show({ onNavigateToWidget: navigate });
  fireEvent.click(screen.getByText('Ethereum'));
  fireEvent.click(await screen.findByText('Second wallet'));
  await waitFor(() => expect(navigate).toHaveBeenCalledOnce());
  expect(api.post.mock.calls[0][1]).toMatchObject({ wallet_uuid: 'wallet-2' });
});

it("labels each wallet's balance and value in the chooser as a Wallets row does", async () => {
  answer([wallet('wallet-1', 'First wallet'), { ...wallet('wallet-2', 'Second wallet'), nativeBalance: '0.42' }]);
  show({});
  fireEvent.click(screen.getByText('Ethereum'));

  const second = await screen.findByRole('button', { name: /Second wallet/ });
  const figuresOf = (choice: HTMLElement) =>
    Array.from(within(choice).getByText('Balance').parentElement!.children).map((cell) => cell.textContent);
  expect(figuresOf(second)).toEqual(['Balance', '0.42 ETH', 'Value', 'A$2']);
  expect(figuresOf(screen.getByRole('button', { name: /First wallet/ }))).toEqual(['Balance', '1 ETH', 'Value', 'A$2']);
});

it('holds every wallet while the chosen one opens the purchase, and marks the chosen one', async () => {
  answer([wallet('wallet-1', 'First wallet'), wallet('wallet-2', 'Second wallet')]);
  api.post.mockReturnValue(new Promise(() => {}));
  show({});
  fireEvent.click(screen.getByText('Ethereum'));

  fireEvent.click(await screen.findByRole('button', { name: /Second wallet/ }));

  await waitFor(() => expect(screen.getByRole('button', { name: /Second wallet/ })).toHaveProperty('disabled', true));
  expect(screen.getByRole('button', { name: /First wallet/ })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: /Second wallet/ }).getAttribute('aria-busy')).toBe('true');
  expect(screen.getByRole('button', { name: /First wallet/ }).hasAttribute('aria-busy')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /First wallet/ }));
  expect(api.post).toHaveBeenCalledOnce();
});

it('says the wallets could not be loaded when the read fails, rather than that there are none, and tries again', async () => {
  answer([wallet('wallet-1', 'First wallet'), wallet('wallet-2', 'Second wallet')]);
  const read = api.get.getMockImplementation()!;
  api.get.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) =>
    url === WALLET_ENDPOINTS.BASE
      ? Promise.reject(new Error('Request failed with status code 500'))
      : read(url, config),
  );
  show({});
  fireEvent.click(screen.getByText('Ethereum'));

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Your wallets could not be loaded. Try again before continuing.');
  expect(screen.queryByText(/No verified wallets for/)).toBeNull();
  expect(screen.queryByText('Request failed with status code 500')).toBeNull();
  expect(screen.queryByText('Something went wrong')).toBeNull();

  api.get.mockImplementation(read);
  fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

  expect(await screen.findByRole('button', { name: /Second wallet/ })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

it('hides the wallets it listed when a refresh fails, rather than buying into one it can no longer vouch for', async () => {
  answer([wallet('wallet-1', 'First wallet'), wallet('wallet-2', 'Second wallet')]);
  const read = api.get.getMockImplementation()!;
  show({});
  fireEvent.click(screen.getByText('Ethereum'));
  await screen.findByRole('button', { name: /Second wallet/ });
  api.get.mockImplementation(() => Promise.reject(new Error('Request failed with status code 500')));

  await act(async () => client.invalidateQueries({ queryKey: ['wallets'] }));

  const alert = await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: /Second wallet/ })).toBeNull();
  let settle!: () => void;
  api.get.mockImplementation(
    (url: string, config?: { params?: Record<string, unknown> }) =>
      new Promise((resolve) => {
        settle = () => resolve(read(url, config));
      }),
  );
  fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));

  await waitFor(() =>
    expect(within(alert).getByRole('button', { name: 'Try again' })).toHaveProperty('disabled', true),
  );
  await act(async () => settle());
  expect(await screen.findByRole('button', { name: /Second wallet/ })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

it('waits for a fresh read before buying into the one wallet it read before, and then goes straight to the widget', async () => {
  const navigate = vi.fn();
  const read = pending<ReturnType<typeof page>>();
  await boughtOnceThenAgain(navigate, () => read.promise);

  expect(screen.getByText('Ethereum').closest('button')).toHaveProperty('disabled', true);
  expect(api.post).toHaveBeenCalledOnce();

  await read.settle(page([wallet('wallet-1', 'First wallet')]));

  await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
  expect(api.post).toHaveBeenCalledTimes(2);
});

it('asks which wallet receives the asset when the fresh read finds two, rather than buying into the one it read before', async () => {
  const navigate = vi.fn();
  const read = pending<ReturnType<typeof page>>();
  await boughtOnceThenAgain(navigate, () => read.promise);

  await read.settle(page([wallet('wallet-1', 'First wallet'), wallet('wallet-2', 'Second wallet')]));

  expect(await screen.findByRole('button', { name: /Second wallet/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /First wallet/ })).toHaveProperty('disabled', false);
  expect(api.post).toHaveBeenCalledOnce();
  expect(navigate).toHaveBeenCalledOnce();
});

it('says the wallets could not be loaded when the fresh read fails, rather than buying into the one it read before', async () => {
  const navigate = vi.fn();
  await boughtOnceThenAgain(navigate, () => Promise.reject(new Error('Request failed with status code 500')));

  expect((await screen.findByRole('alert')).textContent).toContain(
    'Your wallets could not be loaded. Try again before continuing.',
  );
  expect(api.post).toHaveBeenCalledOnce();
  expect(navigate).toHaveBeenCalledOnce();
});

it('holds the wallets it listed before while it reads them again', async () => {
  answer([wallet('wallet-1', 'First wallet'), wallet('wallet-2', 'Second wallet')]);
  show({});
  fireEvent.click(screen.getByText('Ethereum'));
  await screen.findByRole('button', { name: /Second wallet/ });
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  const read = pending<ReturnType<typeof page>>();
  const prices = api.get.getMockImplementation()!;
  api.get.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) =>
    url === WALLET_ENDPOINTS.BASE ? read.promise : prices(url, config),
  );

  fireEvent.click(await screen.findByText('Ethereum'));

  const stale = await screen.findByRole('button', { name: /Second wallet/ });
  expect(stale).toHaveProperty('disabled', true);
  fireEvent.click(stale);
  expect(api.post).not.toHaveBeenCalled();
  await read.settle(page([wallet('wallet-1', 'First wallet'), wallet('wallet-2', 'Second wallet')]));
  await waitFor(() => expect(screen.getByRole('button', { name: /Second wallet/ })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: /Second wallet/ }));
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
  expect(api.post.mock.calls[0][1]).toMatchObject({ wallet_uuid: 'wallet-2' });
});

it('waits for the account before reading its wallets, rather than saying it has none', async () => {
  answer([wallet('wallet-1', 'First wallet'), wallet('wallet-2', 'Second wallet')]);
  const opened = (account?: string) => (
    <QueryClientProvider client={client}>
      <BuyCryptoModal isOpen onClose={() => {}} onNavigateToWidget={() => {}} userAccountUuid={account} />
    </QueryClientProvider>
  );
  const view = render(opened(undefined));
  fireEvent.click(screen.getByText('Ethereum'));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

  expect(screen.queryByText(/No verified wallets for/)).toBeNull();
  expect(screen.getByText('Ethereum').closest('button')).toHaveProperty('disabled', true);
  expect(walletCalls()).toHaveLength(0);

  view.rerender(opened('synthetic-account'));
  expect(await screen.findByRole('button', { name: /Second wallet/ })).toBeTruthy();
});

it('explains a missing wallet and goes back to the asset list', async () => {
  answer([]);
  show({});
  fireEvent.click(screen.getByText('Bitcoin'));
  expect(await screen.findByText('No verified wallets for Bitcoin. Create one in Wallets.')).toBeTruthy();
  fireEvent.click(screen.getByText('Back'));
  expect(screen.getByText('Select an asset to purchase')).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
});

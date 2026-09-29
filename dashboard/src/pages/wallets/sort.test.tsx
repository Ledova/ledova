// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PageTitle } from '@components/PageTitle';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  useCurrency: () => ({ formatDisplayCurrency: (value: number) => `AUD ${value}` }),
}));
vi.mock('./components/CryptoActions', () => ({ CryptoActions: () => null }));

import { WalletsPage } from './index';

function wallet(uuid: string, chain: string, name: string, marketValue: string, signingPreference = 'software') {
  return {
    uuid,
    chain,
    name,
    marketValue,
    signingPreference,
    userAccount: 'owner',
    address: `0x${uuid.repeat(40).slice(0, 40)}`,
    verificationStatus: 'VERIFIED',
    nativeBalance: '0',
    nativeMarketValue: '0',
  };
}

const WALLETS = [
  wallet('b', 'ethereum', 'Bravo', '5'),
  wallet('a', 'ethereum', 'alpha', '1', 'hardware'),
  wallet('c', 'ethereum', '', '9'),
  wallet('d', 'base', 'Zulu', '3', 'hardware'),
  wallet('e', 'base', 'Yankee', '7'),
  wallet('f', 'bitcoin', 'Only coin', '2'),
];
const ORDERS = ['Hardware first', 'Verified first', 'Name, A to Z', 'Named first', 'Highest value', 'Highest balance'];
let client: QueryClient;

function show() {
  render(
    <QueryClientProvider client={client}>
      <PageTitle.Provider value="Wallets">
        <WalletsPage />
      </PageTitle.Provider>
    </QueryClientProvider>,
  );
}

const card = (title: string) => screen.getByRole('heading', { level: 2, name: title }).closest('section')!;
const sortOf = (title: string) => within(card(title)).getByRole('button', { name: /^Sort/ });
const rows = (title: string) =>
  within(card(title))
    .getAllByRole('group')
    .map((group) => group.getAttribute('aria-label'));

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockResolvedValue({ data: { results: WALLETS, count: WALLETS.length, next: null, previous: null } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

it('sorts a chain in place from the top of its card, naming the order, with no title action or dialog', async () => {
  show();
  await screen.findByText('Bravo');
  const title = screen.getByRole('heading', { level: 1, name: 'Wallets' });
  expect(within(title.parentElement!).queryByRole('button', { name: 'Filter' })).toBeNull();
  expect(within(card('Bitcoin')).queryByRole('button', { name: /^Sort/ })).toBeNull();

  const sort = sortOf('Ethereum');
  expect(sort.textContent).toBe('SortHardware first');
  expect(sort.getAttribute('aria-expanded')).toBe('false');
  expect(sort.compareDocumentPosition(within(card('Ethereum')).getAllByRole('group')[0])).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(rows('Ethereum')).toEqual(['alpha', 'Bravo', WALLETS[2].address]);

  fireEvent.click(sort);
  const detail = document.getElementById(sort.getAttribute('aria-controls')!)!;
  expect(sort.getAttribute('aria-expanded')).toBe('true');
  expect(card('Ethereum').contains(detail)).toBe(true);
  expect(
    within(detail)
      .getAllByRole('button')
      .map((option) => [option.textContent, option.getAttribute('aria-pressed')]),
  ).toEqual(ORDERS.map((order, index) => [order, String(index === 0)]));
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(within(detail).getByRole('button', { name: 'Name, A to Z' }));

  expect(sort.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(sort);
  expect(sort.textContent).toBe('SortName, A to Z');
  expect(rows('Ethereum')).toEqual([WALLETS[2].address, 'alpha', 'Bravo']);
  expect(rows('Base')).toEqual(['Zulu', 'Yankee']);
  expect(sortOf('Base').textContent).toBe('SortHardware first');

  fireEvent.click(sortOf('Base'));
  fireEvent.click(within(card('Base')).getByRole('button', { name: 'Highest value' }));
  expect(rows('Base')).toEqual(['Yankee', 'Zulu']);
  expect(rows('Ethereum')).toEqual([WALLETS[2].address, 'alpha', 'Bravo']);

  fireEvent.click(sortOf('Ethereum'));
  expect(within(card('Ethereum')).getByRole('button', { name: 'Name, A to Z' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
});

it('keeps the order when the sort is closed without choosing one', async () => {
  show();
  await screen.findByText('Bravo');

  fireEvent.click(sortOf('Ethereum'));
  fireEvent.click(sortOf('Ethereum'));

  expect(sortOf('Ethereum').getAttribute('aria-expanded')).toBe('false');
  expect(sortOf('Ethereum').textContent).toBe('SortHardware first');
  expect(rows('Ethereum')).toEqual(['alpha', 'Bravo', WALLETS[2].address]);
});

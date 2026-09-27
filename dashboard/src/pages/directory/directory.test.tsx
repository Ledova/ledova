// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DIRECTORY_ENDPOINTS,
  INVESTOR_CLASSIFICATION_ENDPOINTS,
  SUBSCRIPTION_ENDPOINTS,
  WALLET_ENDPOINTS,
  type DirectoryToken,
} from '@ledova/shared';
import { PageTitle } from '@components/PageTitle';
import DirectoryPage from './index';
import DirectoryTokenPage from './detail';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
let client: QueryClient;
const eligibility = { data: { account: 'account', isEligible: true, classification: null, reasons: [] } };
const firstWallet = { uuid: 'wallet-one', name: 'Primary', address: '0x1111111111111111111111111111111111111111' };
const secondWallet = { uuid: 'wallet-two', name: 'Reserve', address: '0x2222222222222222222222222222222222222222' };
const token: DirectoryToken = {
  uuid: 'ordinary',
  name: 'Ordinary',
  symbol: 'ORD',
  companyUuid: 'company',
  companyName: 'Harbour Example Pty Ltd',
  company: { displayName: 'Harbour Example Pty Ltd', industry: 'Food', city: 'Sydney', state: 'NSW' },
  bestAsk: null,
  bestBid: null,
  lastPrice: null,
  chain: 'base',
  contractAddress: firstWallet.address,
  createdAt: '2026-09-01T00:00:00Z',
  deployedAt: '2026-09-01T00:00:00Z',
  decimals: 0,
  isDivisible: false,
  isTransferable: true,
  issuedShares: 9000,
  totalSupply: '9007199254740993',
  status: 'deployed',
  statusDisplay: 'Deployed',
  tokenType: 'ordinary',
  tokenTypeDisplay: 'Shares',
  openOffering: {
    uuid: 'offering',
    opensAt: '2026-09-01T00:00:00Z',
    closesAt: null,
    priceCurrency: 'AUD',
    pricePerShare: '1.25',
  },
};
function page<T>(results: T[], next: string | null = null) {
  return { data: { results, next, previous: null, count: results.length } };
}
function defaults(url: string) {
  if (url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY) return eligibility;
  if (url === DIRECTORY_ENDPOINTS.TOKENS.LIST) return page([token]);
  if (url === DIRECTORY_ENDPOINTS.TOKENS.DETAIL('ordinary')) return { data: token };
  if (url === WALLET_ENDPOINTS.BASE) return page([firstWallet]);
  if (url === '/api/operator/') return { data: { name: 'Example Registry' } };
  throw Error(`Unexpected request ${url}`);
}
function renderPage(detail = false) {
  return render(
    <MemoryRouter initialEntries={[detail ? '/directory/ordinary' : '/directory']}>
      <QueryClientProvider client={client}>
        <PageTitle.Provider value={detail ? 'Share class' : 'Directory'}>
          <Routes>
            <Route path="/directory" element={<DirectoryPage />} />
            <Route path="/directory/:uuid" element={<DirectoryTokenPage />} />
            <Route path="/subscriptions/:uuid" element={<h1>Application detail</h1>} />
          </Routes>
        </PageTitle.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockImplementation(async (url: string) => defaults(url));
  api.post.mockResolvedValue({ data: { uuid: 'created' } });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it('shows every available class under its company, including later pages and classes without an offering', async () => {
  api.get.mockImplementation(async (url: string, config?: { params: { page: number } }) =>
    url === DIRECTORY_ENDPOINTS.TOKENS.LIST
      ? config?.params.page === 1
        ? page([token], 'http://localhost/api/v1/directory/tokens/?page=2')
        : page([{ ...token, uuid: 'preference', name: 'Preference', openOffering: null }])
      : defaults(url),
  );
  renderPage();
  expect(await screen.findByRole('heading', { name: 'Harbour Example Pty Ltd' })).toBeTruthy();
  expect(screen.getByRole('link', { name: /Ordinary/ }).getAttribute('href')).toBe('/directory/ordinary');
  expect(screen.getByRole('link', { name: /Preference/ }).getAttribute('href')).toBe('/directory/preference');
  expect(screen.getByText('No offering open')).toBeTruthy();
  expect(screen.getByText(/AUD\s1.25 per share/)).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith(DIRECTORY_ENDPOINTS.TOKENS.LIST, { params: { page: 2 } });
});

it('waits for eligibility and directs an ineligible investor to Verification without reading directory entries', async () => {
  let finish!: (value: typeof eligibility) => void;
  api.get.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  renderPage();
  expect(screen.getByRole('status')).toBeTruthy();
  expect(screen.queryByText('No share classes available')).toBeNull();
  await act(async () => finish({ data: { ...eligibility.data, isEligible: false } }));
  expect(await screen.findByRole('link', { name: 'Open Verification' })).toBeTruthy();
  expect(api.get.mock.calls.some(([url]) => url === DIRECTORY_ENDPOINTS.TOKENS.LIST)).toBe(false);
});

it.each(['eligibility', 'first page', 'later page'])(
  'retries %s failure without claiming the directory is empty',
  async (source) => {
    let broken = true;
    api.get.mockImplementation(async (url: string, config?: { params: { page: number } }) => {
      if (
        broken &&
        ((source === 'eligibility' && url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY) ||
          (source === 'first page' && url === DIRECTORY_ENDPOINTS.TOKENS.LIST) ||
          (source === 'later page' && config?.params.page === 2))
      )
        throw Error('Unavailable');
      if (url === DIRECTORY_ENDPOINTS.TOKENS.LIST && source === 'later page' && config?.params.page === 1)
        return page([token], 'http://localhost/api/v1/directory/tokens/?page=2');
      if (url === DIRECTORY_ENDPOINTS.TOKENS.LIST && source === 'later page' && config?.params.page === 2)
        return page([]);
      return defaults(url);
    });
    renderPage();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No share classes available')).toBeNull();
    expect(screen.queryByRole('link', { name: /Ordinary/ })).toBeNull();
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: /Ordinary/ })).toBeTruthy();
  },
);

it('distinguishes a successful empty directory from a failure', async () => {
  api.get.mockImplementation(async (url: string) =>
    url === DIRECTORY_ENDPOINTS.TOKENS.LIST ? page([]) : defaults(url),
  );
  renderPage();
  expect(await screen.findByText('No share classes available')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('suppresses stale class links when the directory refresh fails', async () => {
  renderPage();
  await screen.findByRole('link', { name: /Ordinary/ });
  api.get.mockRejectedValue(Error('Unavailable'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['directory'] });
  });
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Ordinary/ })).toBeNull();
});

it('shows exact authorised shares, with no last-price currency guess or generic bank instructions', async () => {
  renderPage(true);
  expect(await screen.findByText('9,007,199,254,740,993')).toBeTruthy();
  expect(screen.getByText('9,000')).toBeTruthy();
  expect(await screen.findByRole('heading', { name: 'Apply for shares' })).toBeTruthy();
  expect(await screen.findByText(/Example Registry reviews your application/)).toBeTruthy();
  expect(screen.queryByText('Last traded price')).toBeNull();
  expect(screen.queryByText('Account number')).toBeNull();
});

it('does not invent an exact issued count from an unsafe numeric API value', async () => {
  api.get.mockImplementation(async (url: string) =>
    url === DIRECTORY_ENDPOINTS.TOKENS.DETAIL('ordinary')
      ? { data: { ...token, issuedShares: 9007199254740992 } }
      : defaults(url),
  );
  renderPage(true);
  expect(await screen.findByText('Unavailable')).toBeTruthy();
  expect(screen.queryByText('9,007,199,254,740,992')).toBeNull();
});

it('distinguishes an unavailable class from a service failure, which can be retried', async () => {
  let status = 500;
  api.get.mockImplementation(async (url: string) => {
    if (url === DIRECTORY_ENDPOINTS.TOKENS.DETAIL('ordinary') && status) throw { response: { status } };
    return defaults(url);
  });
  renderPage(true);
  expect(await screen.findByText('This share class could not be loaded. Try again before continuing.')).toBeTruthy();
  expect(screen.queryByText('Share class not available')).toBeNull();
  status = 404;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Share class not available')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Apply for shares' })).toBeNull();
});

it('hides stale application actions after a failed class refresh', async () => {
  renderPage(true);
  await screen.findByRole('button', { name: 'Create application' });
  api.get.mockImplementation(async (url: string) => {
    if (url === DIRECTORY_ENDPOINTS.TOKENS.DETAIL('ordinary')) throw Error('Unavailable');
    return defaults(url);
  });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['directory'] });
  });
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Create application' })).toBeNull();
});

it('reads every verified Base wallet page and creates a draft for the selected wallet without a preferences read', async () => {
  api.get.mockImplementation(async (url: string, config?: { params: { page: number } }) =>
    url === WALLET_ENDPOINTS.BASE
      ? config?.params.page === 1
        ? page([firstWallet], 'http://localhost/api/wallets/?page=2')
        : page([secondWallet])
      : defaults(url),
  );
  renderPage(true);
  fireEvent.change(await screen.findByLabelText('Shares'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('Receiving wallet (Base)'), { target: { value: 'wallet-two' } });
  expect(screen.getByText(/AUD\s3.75/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create application' }));
  expect(await screen.findByRole('heading', { name: 'Application detail' })).toBeTruthy();
  expect(api.post).toHaveBeenCalledWith(SUBSCRIPTION_ENDPOINTS.BASE, {
    offering: 'offering',
    wallet: 'wallet-two',
    quantity: 3,
  });
  expect(api.get).toHaveBeenCalledWith(WALLET_ENDPOINTS.BASE, {
    params: { chain: 'base', verification_status: 'VERIFIED', page: 2 },
  });
  expect(api.get.mock.calls.some(([url]) => url === '/api/user-preferences/')).toBe(false);
});

it('keeps a failed wallet page distinct from having no verified wallets and retries the complete list', async () => {
  let broken = true;
  api.get.mockImplementation(async (url: string, config?: { params: { page: number } }) => {
    if (url !== WALLET_ENDPOINTS.BASE) return defaults(url);
    if (config?.params.page === 1) return page([firstWallet], 'http://localhost/api/wallets/?page=2');
    if (broken) throw Error('Unavailable');
    return page([secondWallet]);
  });
  renderPage(true);
  expect(
    await screen.findByText('Your receiving wallets could not be loaded. Try again before applying.'),
  ).toBeTruthy();
  expect(screen.queryByText('Add a receiving wallet')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create application' })).toBeNull();
  broken = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try wallets again' }));
  expect(await screen.findByRole('option', { name: /Reserve/ })).toBeTruthy();
});

it('does not fetch wallets or show an application form when no offering is open', async () => {
  api.get.mockImplementation(async (url: string) =>
    url === DIRECTORY_ENDPOINTS.TOKENS.DETAIL('ordinary') ? { data: { ...token, openOffering: null } } : defaults(url),
  );
  renderPage(true);
  expect(await screen.findByText('No offering open')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Create application' })).toBeNull();
  expect(api.get.mock.calls.some(([url]) => url === WALLET_ENDPOINTS.BASE)).toBe(false);
});

it('shows a successful empty wallet read with a working Wallets link', async () => {
  api.get.mockImplementation(async (url: string) => (url === WALLET_ENDPOINTS.BASE ? page([]) : defaults(url)));
  renderPage(true);
  expect(await screen.findByRole('link', { name: 'Open Wallets' })).toHaveProperty(
    'href',
    'http://localhost:3000/wallets',
  );
  expect(screen.queryByRole('alert')).toBeNull();
});

it('surfaces an operator-read failure with retry while keeping the independently valid application available', async () => {
  let broken = true;
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/operator/' && broken) throw Error('Unavailable');
    return defaults(url);
  });
  renderPage(true);
  expect(await screen.findByText('Operator details could not be loaded.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Create application' })).toBeTruthy();
  broken = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try operator details again' }));
  expect(await screen.findByText(/Example Registry reviews your application/)).toBeTruthy();
});

it('preserves entered draft details when creation fails and permits retry', async () => {
  api.post
    .mockRejectedValueOnce({ response: { data: { detail: 'The offering is now closed.' } } })
    .mockResolvedValue({ data: { uuid: 'created' } });
  renderPage(true);
  fireEvent.change(await screen.findByLabelText('Shares'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create application' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The offering is now closed.');
  expect((screen.getByLabelText('Shares') as HTMLInputElement).value).toBe('7');
  fireEvent.click(screen.getByRole('button', { name: 'Create application' }));
  expect(await screen.findByRole('heading', { name: 'Application detail' })).toBeTruthy();
});

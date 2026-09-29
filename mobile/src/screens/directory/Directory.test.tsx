import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider } from '@ledova/shared';
import { DirectoryScreen } from './DirectoryScreen';
import { ShareClassScreen } from './ShareClassScreen';
import { DirectoryStackNavigator } from '../../navigation/DirectoryStackNavigator';
import { apiClient } from '../../services/apiClient';

const mockNavigate = jest.fn();
const mockParentNavigate = jest.fn();
let mockRole = { isInvestor: true, isLoading: false };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, getParent: () => ({ navigate: mockParentNavigate }) }),
  useRoute: () => ({ params: { uuid: 'class-a' } }),
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Screen: ({ name, component: Component }: { name: string; component: React.ComponentType }) =>
      name === 'DirectoryMain' ? <Component /> : null,
  }),
}));
jest.mock('../../navigation/headers', () => ({ MainHeader: () => ({}), getMainHeaderStyle: () => ({}) }));
jest.mock('../../hooks/useRole', () => ({ useRole: () => mockRole }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn() } }));

const eligibilityUrl = '/api/investor-classifications/eligibility/';
const listUrl = '/api/v1/directory/tokens/';
const detailUrl = `${listUrl}class-a/`;
const operatorUrl = '/api/operator/';
const get = jest.mocked(apiClient.get);
let client: QueryClient;
let eligible: boolean;
let pages: Record<number, object>;
let token: ReturnType<typeof shareClass>;
let failure: string | null;
let notFound: boolean;

function shareClass(uuid = 'class-a') {
  return {
    uuid,
    companyUuid: 'issuer-a',
    name: uuid === 'class-a' ? 'Ordinary shares' : 'Preference shares',
    symbol: uuid === 'class-a' ? 'HARBOUR' : 'HARBOURP',
    totalSupply: '9007199254740993123456789',
    issuedShares: 123456,
    company: { displayName: 'Fictional Harbour Pty Ltd', industry: 'Fictional research', city: 'Sydney', state: 'NSW' },
    openOffering: {
      uuid: 'offer-a',
      pricePerShare: '12.30',
      priceCurrency: 'AUD',
      opensAt: '2026-09-01T10:00:00Z',
      closesAt: null,
    } as { uuid: string; pricePerShare: string; priceCurrency: 'AUD'; opensAt: string; closesAt: string | null } | null,
  };
}

beforeEach(() => {
  mockRole = { isInvestor: true, isLoading: false };
  eligible = true;
  token = shareClass();
  pages = { 1: { results: [token], next: null } };
  failure = null;
  notFound = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  get.mockReset().mockImplementation(async (url, config) => {
    const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
    if (failure === url || failure === `${url}${page}`) throw new Error('Synthetic read unavailable');
    if (url === eligibilityUrl) return { data: { isEligible: eligible } };
    if (url === listUrl) return { data: pages[page] };
    if (url === detailUrl) {
      if (notFound) throw { response: { status: 404 } };
      return { data: token };
    }
    if (url === '/api/wallets/') return { data: { results: [], next: null } };
    if (url === operatorUrl) return { data: { name: 'Fictional Ledova Operator' } };
    throw new Error(`Unexpected request ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

it.each([
  [true, true],
  [false, false],
])('waits for an investing role before reading Directory (%s, %s)', async (isLoading, isInvestor) => {
  mockRole = { isLoading, isInvestor };
  const view = await render(<DirectoryStackNavigator onNotifications={() => {}} unreadCount={0} />, { wrapper });
  expect(get).not.toHaveBeenCalled();
  expect(view.queryByText('Directory')).toBeNull();
  mockRole = { isLoading: false, isInvestor: true };
  await view.rerender(<DirectoryStackNavigator onNotifications={() => {}} unreadCount={0} />);
  expect(await view.findByText('Ordinary shares')).toBeTruthy();
  expect(get).toHaveBeenCalledWith(listUrl, { params: { page: 1 } });
});

it('shows verification before reading classes and navigates to the existing Verification destination', async () => {
  eligible = false;
  const view = await render(<DirectoryScreen />, { wrapper });
  await fireEvent.press(await view.findByText('Verification'));
  expect(mockParentNavigate).toHaveBeenCalledWith('InvestorEligibility');
  expect(get.mock.calls.map(([url]) => url)).toEqual([eligibilityUrl]);
});

it('reads all class pages, keeps the simple cache separate and opens the selected class', async () => {
  pages = {
    1: { results: [token], next: `https://example.test${listUrl}?page=2` },
    2: { results: [shareClass('class-b')], next: null },
  };
  const oldCache = { data: { results: [], next: null } };
  client.setQueryData(['directory', 'tokens'], oldCache);
  const view = await render(<DirectoryScreen />, { wrapper });
  await fireEvent.press(await view.findByLabelText('Open Preference shares'));
  expect(view.getByText('Ordinary shares')).toBeTruthy();
  expect(get).toHaveBeenCalledWith(listUrl, { params: { page: 2 } });
  expect(client.getQueryData(['directory', 'tokens'])).toEqual(oldCache);
  expect(mockNavigate).toHaveBeenCalledWith('DirectoryClass', { uuid: 'class-b' });
});

it.each([eligibilityUrl, listUrl, `${listUrl}2`])(
  'does not present failed %s as an empty or partial directory and recovers',
  async (url) => {
    pages = { 1: { results: [token], next: `https://example.test${listUrl}?page=2` }, 2: { results: [], next: null } };
    failure = url;
    const view = await render(<DirectoryScreen />, { wrapper });
    expect(await view.findByText(/The directory could not be loaded/)).toBeTruthy();
    expect(view.queryByText('No share classes available.')).toBeNull();
    expect(view.queryByText('Ordinary shares')).toBeNull();
    expect(view.queryByText('Verify your investor status')).toBeNull();
    failure = null;
    await fireEvent.press(view.getByText('Try again'));
    expect(await view.findByText('Ordinary shares')).toBeTruthy();
  },
);

it.each([`https://example.test${listUrl}?page=1`, `https://example.test${listUrl}?cursor=next`])(
  'refuses incomplete pagination %s',
  async (next) => {
    pages = { 1: { results: [token], next } };
    const view = await render(<DirectoryScreen />, { wrapper });
    expect(await view.findByText(/The directory could not be loaded/)).toBeTruthy();
    expect(view.queryByText('Ordinary shares')).toBeNull();
    expect(get.mock.calls.filter(([url]) => url === listUrl)).toHaveLength(1);
  },
);

it('shows a reliable empty directory only after both reads succeed', async () => {
  pages = { 1: { results: [], next: null } };
  const view = await render(<DirectoryScreen />, { wrapper });
  expect(await view.findByText('No share classes available.')).toBeTruthy();
  expect(view.getByText('Share classes')).toBeTruthy();
  expect(view.queryByText('Verify your investor status')).toBeNull();
});

it('removes cached classes after a failed eligibility refresh or revoked eligibility', async () => {
  const view = await render(<DirectoryScreen />, { wrapper });
  expect(await view.findByText('Ordinary shares')).toBeTruthy();
  failure = eligibilityUrl;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['investor-eligibility'] });
  });
  expect(await view.findByText(/The directory could not be loaded/)).toBeTruthy();
  expect(view.queryByText('Ordinary shares')).toBeNull();
  failure = null;
  eligible = false;
  await fireEvent.press(view.getByText('Try again'));
  expect(await view.findByText('Verify your investor status')).toBeTruthy();
  expect(view.queryByText('Ordinary shares')).toBeNull();
});

it('shows exact authorised shares, safe issued shares and AUD offering terms without collecting payment', async () => {
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('9,007,199,254,740,993,123,456,789')).toBeTruthy();
  expect(view.getByText('123,456')).toBeTruthy();
  expect(view.getByText('AUD\u00a012.30')).toBeTruthy();
  expect(view.getByText('No closing date')).toBeTruthy();
  expect(await view.findByText('Add a receiving wallet')).toBeTruthy();
  expect(await view.findByText(/Fictional Ledova Operator reviews your application/)).toBeTruthy();
  await fireEvent.press(view.getByText('Back to Directory'));
  expect(mockNavigate).toHaveBeenCalledWith('DirectoryMain');
});

it.each([Number.MAX_SAFE_INTEGER + 1, -1])('does not invent an issued share count for %s', async (issuedShares) => {
  token.issuedShares = issuedShares;
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('Unavailable')).toBeTruthy();
  expect(view.getByText('9,007,199,254,740,993,123,456,789')).toBeTruthy();
});

it('suppresses stale class and offering terms after a failed refresh, then reflects closure', async () => {
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('Open for applications')).toBeTruthy();
  failure = detailUrl;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['directory', 'token'] });
  });
  expect(await view.findByText(/This share class could not be loaded/)).toBeTruthy();
  expect(view.queryByText('Open for applications')).toBeNull();
  expect(view.queryByText('AUD\u00a012.30')).toBeNull();
  failure = null;
  token.openOffering = null;
  await fireEvent.press(view.getByText('Try again'));
  expect(await view.findByText('No offering open')).toBeTruthy();
  expect(view.getByText('Ordinary shares')).toBeTruthy();
});

it.each([
  ['a failed read', () => (failure = detailUrl), /This share class could not be loaded/],
  ['the class becoming unavailable', () => (notFound = true), 'Share class not available'],
])('names the company under the title, and drops that lede with the class after %s', async (_, fail, state) => {
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('Ordinary shares')).toBeTruthy();
  const title = view.getByRole('header', { name: 'Share class' });
  expect(title.parent!.children[1]).toBe(view.getByText('Fictional Harbour Pty Ltd'));
  fail();
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['directory', 'token'] });
  });
  expect(await view.findByText(state)).toBeTruthy();
  expect(view.getByRole('header', { name: 'Share class' })).toBeTruthy();
  expect(view.queryByText('Fictional Harbour Pty Ltd')).toBeNull();
});

it('treats a newly unavailable class as unavailable even with a cached prior record', async () => {
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('Ordinary shares')).toBeTruthy();
  notFound = true;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['directory', 'token'] });
  });
  expect(await view.findByText('Share class not available')).toBeTruthy();
  expect(view.queryByText('Ordinary shares')).toBeNull();
  expect(view.queryByText('Open for applications')).toBeNull();
});

it('keeps class reads independent of operator failure and retries the operator explicitly', async () => {
  failure = operatorUrl;
  const view = await render(<ShareClassScreen />, { wrapper });
  expect(await view.findByText('Operator details could not be loaded.')).toBeTruthy();
  expect(view.getByText('Ordinary shares')).toBeTruthy();
  expect(view.queryByText(/reviews your application/)).toBeNull();
  failure = null;
  await fireEvent.press(view.getByText('Try operator details again'));
  expect(await view.findByText(/Fictional Ledova Operator reviews your application/)).toBeTruthy();
});

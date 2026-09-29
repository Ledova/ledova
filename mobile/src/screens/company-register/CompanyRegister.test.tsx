import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { COMPANY_TOKEN_ENDPOINTS, HOLDER_TYPE_LABELS, REGISTER_COPY } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { CompanyRegisterScreen } from './CompanyRegisterScreen';

const mockNavigate = jest.fn();
let mockPreferences = { userAccount: { role: 'company' }, isLoading: false, isError: false, refetch: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => mockPreferences,
}));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn() } }));

const get = jest.mocked(apiClient.get);
const shareClass = { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', companyName: 'Paper Company' };
const register = {
  token: { ...shareClass, totalSupply: '9007199254740995' },
  issuedSupply: '9007199254740993',
  initialized: true,
  waitingEffects: null,
  totalHolders: 2,
  holders: [
    {
      member: 'member-1',
      name: 'Alex Member',
      holderType: 'member',
      balance: '9007199254740992',
      enteredOn: '2026-09-01',
      wallets: [],
    },
    {
      member: 'member-2',
      name: null,
      holderType: 'unidentified',
      balance: '1',
      enteredOn: '2026-09-02',
      wallets: [{ address: `0x${'1'.repeat(40)}`, whitelistStatus: 'active' }],
    },
  ],
};
let client: QueryClient;
let read: (url: string, page: number) => Promise<unknown>;
const page = (results: unknown[], next: string | null = null) => ({ data: { results, next, count: results.length } });
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockPreferences = { userAccount: { role: 'company' }, isLoading: false, isError: false, refetch: jest.fn() };
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
  });
  read = async (url, number) => {
    if (url === COMPANY_TOKEN_ENDPOINTS.BASE)
      return number === 1
        ? page([shareClass], 'https://api.example.test/?page=2')
        : page([{ ...shareClass, uuid: 'preference', name: 'Preference shares' }]);
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary')) return { data: register };
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'))
      return {
        data: {
          ...register,
          token: { ...register.token, uuid: 'preference', name: 'Preference shares' },
          initialized: false,
          issuedSupply: null,
          holders: [],
        },
      };
    throw new Error(`Unexpected ${url}`);
  };
  get.mockReset();
  get.mockImplementation(
    (url, config) =>
      read(url, (config?.params as { page?: number } | undefined)?.page ?? 1) as ReturnType<typeof apiClient.get>,
  );
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

it('reads every class and displays exact stored members including members without wallets', async () => {
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await waitFor(() => expect(view.getByRole('button', { name: 'Open Preference shares' })).toBeTruthy());
  expect(get).toHaveBeenCalledWith(COMPANY_TOKEN_ENDPOINTS.BASE, { params: { page: 2 } });
  await fireEvent.press(view.getByRole('button', { name: 'Ordinary shares register' }));
  expect(view.getByText('9,007,199,254,740,993')).toBeTruthy();
  expect(view.getByText('9,007,199,254,740,992 shares')).toBeTruthy();
  expect(view.getByText('1 share')).toBeTruthy();
  expect(view.getByText(REGISTER_COPY.NO_WALLET)).toBeTruthy();
  expect(view.getByText(REGISTER_COPY.WAITING_UNKNOWN_NOTE)).toBeTruthy();
  expect(view.getByText(REGISTER_COPY.UNIDENTIFIED_NOTE)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Preference shares register' }));
  expect(view.getByText(REGISTER_COPY.NOT_OPENED_NOTE)).toBeTruthy();
  expect(view.getByText('Not recorded')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Open Ordinary shares' }));
  expect(mockNavigate).toHaveBeenLastCalledWith('TokenDetail', { uuid: 'ordinary', name: 'Ordinary shares' });
});

it('draws one rule between classes and none above the card edge', async () => {
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  const lastLink = await view.findByRole('button', { name: 'Open Preference shares' });
  expect(lastLink).not.toHaveStyle({ borderBottomWidth: 1 });
  expect(lastLink.parent!.children).toEqual([lastLink]);
  expect(view.getByRole('button', { name: 'Open Ordinary shares' }).parent!.children).toHaveLength(1);
  expect(view.getByRole('button', { name: 'Ordinary shares register' }).parent).toHaveStyle({ borderBottomWidth: 1 });
  expect(view.getByRole('button', { name: 'Preference shares register' }).parent).toHaveStyle({
    borderBottomWidth: 0,
  });
  await fireEvent.press(view.getByRole('button', { name: 'Preference shares register' }));
  const openLink = view.getByRole('button', { name: 'Open Preference shares' });
  const [link, rule, classRegister] = openLink.parent!.children;
  expect(link).toBe(openLink);
  expect(rule).toHaveStyle({ height: 1 });
  expect(classRegister).toBeTruthy();
  expect(openLink).not.toHaveStyle({ borderBottomWidth: 1 });
  await fireEvent.press(view.getByRole('button', { name: 'Ordinary shares register' }));
  expect(view.getByText('Alex Member').parent).toHaveStyle({ borderBottomWidth: 1 });
  expect(view.getByText(HOLDER_TYPE_LABELS.unidentified).parent).toHaveStyle({ borderBottomWidth: 0 });
});

it.each(['foreign-class', 'fractional-balance', 'holder-read'])(
  'refuses incomplete or malformed register %s and retries',
  async (failure) => {
    read = async (url) => {
      if (url === COMPANY_TOKEN_ENDPOINTS.BASE) return page([shareClass]);
      if (failure === 'holder-read') throw new Error('Unavailable');
      return {
        data:
          failure === 'foreign-class'
            ? { ...register, token: { ...register.token, uuid: 'foreign' } }
            : { ...register, holders: [{ ...register.holders[0], balance: '1.5' }] },
      };
    };
    const view = await render(<CompanyRegisterScreen />, { wrapper });
    await waitFor(() => expect(view.getByText('We couldn’t load the complete register.')).toBeTruthy());
    expect(view.queryByText('Your company has no share classes yet.')).toBeNull();
    read = async (url) => (url === COMPANY_TOKEN_ENDPOINTS.BASE ? page([shareClass]) : { data: register });
    await fireEvent.press(view.getByRole('button', { name: 'Retry register' }));
    await waitFor(() => expect(view.getByRole('button', { name: 'Open Ordinary shares' })).toBeTruthy());
  },
);

it('hides old member rows when a refresh fails instead of presenting a complete register', async () => {
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await waitFor(() => expect(view.getByRole('button', { name: 'Ordinary shares register' })).toBeTruthy());
  await fireEvent.press(view.getByRole('button', { name: 'Ordinary shares register' }));
  expect(view.getByText('Alex Member')).toBeTruthy();
  read = async () => {
    throw new Error('Unavailable');
  };
  await act(() => client.invalidateQueries({ queryKey: ['company-tokens'] }));
  await waitFor(() => expect(view.getByText('We couldn’t load the complete register.')).toBeTruthy());
  expect(view.queryByText('Alex Member')).toBeNull();
});

it.each(['investor', 'loading', 'error'])(
  'does not read issuer records with %s access, including pull-to-refresh',
  async (state) => {
    if (state === 'investor') mockPreferences.userAccount.role = 'investor';
    if (state === 'loading') {
      mockPreferences.userAccount.role = 'investor';
      mockPreferences.isLoading = true;
    }
    if (state === 'error') mockPreferences.isError = true;
    const view = await render(<CompanyRegisterScreen />, { wrapper });
    await act(() => view.getByTestId('register-screen').props.refreshControl.props.onRefresh());
    expect(get).not.toHaveBeenCalled();
  },
);

import React from 'react';
import { Alert } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { signout } from '@ledova/shared';
import { notificationsService } from '../services/notificationsService';
import { clearTokens } from '../services/tokenStorage';
import { DrawerNavigator } from './DrawerNavigator';

const mockReset = jest.fn();
const mockNavigate = jest.fn();
let mockRole = { isCompany: false, isInvestor: true, isLoading: false };
let mockTradingEnabled = false;
let mockProfile: { fullName?: string | null; email: string } | null = null;
const mockCompanies = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ reset: mockReset, navigate: mockNavigate }) }));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({ Navigator: () => null, Screen: () => null }),
}));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  signout: jest.fn(),
  getCompanies: () => mockCompanies(),
  useNotifications: () => ({ unreadCount: 0 }),
}));
jest.mock('./DrawerContext', () => ({
  DrawerProvider: ({ children, renderMenu }: { children: React.ReactNode; renderMenu: () => React.ReactNode }) => (
    <>
      {children}
      {renderMenu()}
    </>
  ),
  useDrawer: () => ({ closeDrawer: () => {} }),
}));
jest.mock('./BottomTabNavigator', () => ({ BottomTabNavigator: () => null }));
jest.mock('./headers', () => ({ MainHeader: () => ({}), getMainHeaderStyle: () => ({}) }));
jest.mock('../screens/help', () => ({ HelpScreen: () => null }));
jest.mock('../screens/settings', () => ({ SettingsScreen: () => null }));
jest.mock('../components/notifications', () => ({ NotificationsModal: () => null }));
jest.mock('../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ isEnabled: () => mockTradingEnabled }) }));
jest.mock('../hooks/useRole', () => ({ useRole: () => mockRole }));
jest.mock('../screens/user-profile/useUserProfile', () => ({ useUserProfile: () => ({ userProfile: mockProfile }) }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('../services/apiClient', () => ({ apiClient: {} }));
jest.mock('../services/notificationsService', () => ({ notificationsService: { unregisterToken: jest.fn() } }));
jest.mock('../services/tokenStorage', () => ({ clearTokens: jest.fn() }));

const account = ['account'];
let client: QueryClient;
let events: string[];
const pendingCompanyReads: (() => void)[] = [];

function readCompanyLater() {
  return new Promise<ReturnType<typeof companyList>>((resolve) => {
    pendingCompanyReads.push(() => resolve(companyList([])));
  });
}

function cache() {
  return client.getQueryData(account) ? 'kept' : 'cleared';
}

beforeEach(() => {
  mockRole = { isCompany: false, isInvestor: true, isLoading: false };
  mockTradingEnabled = false;
  mockProfile = null;
  mockCompanies.mockReset().mockImplementation(readCompanyLater);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(account, { email: 'synthetic@example.test' });
  events = [];
  jest.mocked(notificationsService.unregisterToken).mockImplementation(async () => {
    events.push('unregister push');
  });
  jest.mocked(signout).mockImplementation(async () => {
    events.push('server sign-out');
    return {} as Awaited<ReturnType<typeof signout>>;
  });
  mockReset.mockImplementation(() => events.push(`navigate with cache ${cache()}`));
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(async () => {
  await cleanup();
  await act(() => pendingCompanyReads.splice(0).forEach((settle) => settle()));
  client.clear();
});

it.each([
  ['confirmed', undefined, []],
  [
    'unconfirmed',
    new Error('synthetic storage detail'),
    [
      [
        'Sign-Out Warning',
        'You are signed out, but this device could not confirm that your saved sign-in was removed. If Ledova opens signed in, sign out again.',
      ],
    ],
  ],
])('finishes signing out when local retirement is %s', async (_, failure, alerts) => {
  jest.mocked(clearTokens).mockImplementation(async () => {
    events.push('retirement started');
    await new Promise((resolve) => setTimeout(resolve));
    events.push(`retirement settled with cache ${cache()}`);
    if (failure) throw failure;
  });
  const view = await render(
    <QueryClientProvider client={client}>
      <DrawerNavigator />
    </QueryClientProvider>,
  );

  await fireEvent.press(view.getByRole('button', { name: 'Sign out' }));
  await fireEvent.press(view.getAllByText('Sign Out').at(-1)!);

  await waitFor(() => expect(view.queryByText('Sign Out')).toBeNull());
  expect(events).toEqual([
    'unregister push',
    'server sign-out',
    'retirement started',
    'retirement settled with cache kept',
    'navigate with cache cleared',
  ]);
  expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'SignIn' }] });
  expect(jest.mocked(Alert.alert).mock.calls).toEqual(alerts);

  await fireEvent.press(view.getByRole('button', { name: 'Sign out' }));
  expect(view.getAllByText('Sign Out')).toHaveLength(2);
  expect(view.queryByText('Loading...')).toBeNull();
});

it.each([
  ['investor', false, true],
  ['company', true, false],
  ['both', true, true],
])('keeps shares accessible for %s and limits each work group to its role', async (_, isCompany, isInvestor) => {
  mockRole = { isCompany, isInvestor, isLoading: false };
  mockTradingEnabled = true;
  const view = await render(
    <QueryClientProvider client={client}>
      <DrawerNavigator />
    </QueryClientProvider>,
  );
  for (const name of ['Holdings', 'Notices', 'Activity', 'Wallets'])
    expect(view.getByRole('button', { name })).toBeTruthy();
  expect(Boolean(view.queryByRole('header', { name: 'Company' }))).toBe(isCompany);
  expect(Boolean(view.queryByRole('button', { name: 'Register' }))).toBe(isCompany);
  expect(Boolean(view.queryByRole('button', { name: 'Offerings' }))).toBe(isCompany);
  expect(Boolean(view.queryByRole('button', { name: 'Company' }))).toBe(isCompany);
  expect(view.queryByRole('button', { name: 'Application' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Published to your members' })).toBeNull();
  expect(Boolean(view.queryByRole('header', { name: 'Invest' }))).toBe(isInvestor);
  expect(Boolean(view.queryByRole('button', { name: 'Market' }))).toBe(isInvestor);
  expect(Boolean(view.queryByRole('button', { name: 'Verification' }))).toBe(isInvestor);
  expect(Boolean(view.queryByRole('button', { name: 'Directory' }))).toBe(isInvestor);
  expect(Boolean(view.queryByRole('button', { name: 'Applications' }))).toBe(isInvestor);
  expect(view.queryByRole('button', { name: 'Buy' })).toBeNull();
  expect(view.queryByRole('button', { name: 'Send' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Holdings' }));
  expect(mockNavigate).toHaveBeenLastCalledWith('MainApp', {
    screen: 'Main',
    params: { screen: 'Home', params: { screen: 'HomeMain' } },
  });
  await fireEvent.press(view.getByRole('button', { name: 'Notices' }));
  expect(mockNavigate).toHaveBeenLastCalledWith('MainApp', { screen: 'Main', params: { screen: 'Publications' } });
  await fireEvent.press(view.getByRole('button', { name: 'Activity' }));
  expect(mockNavigate).toHaveBeenLastCalledWith('MainApp', { screen: 'Main', params: { screen: 'Transactions' } });
  if (isCompany) {
    const buttons = view.getAllByRole('button');
    const at = (name: string) => buttons.indexOf(view.getByRole('button', { name }));
    expect([at('Offerings'), at('Company')]).toEqual([at('Register') + 1, at('Register') + 2]);
    await fireEvent.press(view.getByRole('button', { name: 'Offerings' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('MainApp', {
      screen: 'Main',
      params: { screen: 'Company', params: { screen: 'CompanyOfferings' } },
    });
    await fireEvent.press(view.getByRole('button', { name: 'Register' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('MainApp', {
      screen: 'Main',
      params: { screen: 'Company', params: { screen: 'CompanyMain' } },
    });
    await fireEvent.press(view.getByRole('button', { name: 'Company' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('MainApp', {
      screen: 'Main',
      params: { screen: 'Company', params: { screen: 'CompanyDetails' } },
    });
  }
  if (isInvestor) {
    await fireEvent.press(view.getByRole('button', { name: 'Applications' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('MainApp', {
      screen: 'Main',
      params: { screen: 'Applications', params: { screen: 'ApplicationsMain' } },
    });
    await fireEvent.press(view.getByRole('button', { name: 'Directory' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('MainApp', {
      screen: 'Main',
      params: { screen: 'Directory', params: { screen: 'DirectoryMain' } },
    });
    await fireEvent.press(view.getByRole('button', { name: 'Market' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('MainApp', {
      screen: 'Main',
      params: { screen: 'Trading', params: { screen: 'TradingMain' } },
    });
  }
});

it('keeps securities Market behind its feature flag and waits for the role before showing work groups', async () => {
  mockRole = { isCompany: false, isInvestor: true, isLoading: true };
  const view = await render(
    <QueryClientProvider client={client}>
      <DrawerNavigator />
    </QueryClientProvider>,
  );
  expect(view.queryByText('Your shares')).toBeNull();
  expect(view.queryByText('Invest')).toBeNull();
  mockRole.isLoading = false;
  await view.rerender(
    <QueryClientProvider client={client}>
      <DrawerNavigator />
    </QueryClientProvider>,
  );
  expect(view.getByText('Your shares')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Verification' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Market' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Wallets' }));
  expect(mockNavigate).toHaveBeenLastCalledWith('MainApp', {
    screen: 'Main',
    params: { screen: 'Wallets', params: { screen: 'WalletsList' } },
  });
});

async function footOf() {
  const view = await render(
    <QueryClientProvider client={client}>
      <DrawerNavigator />
    </QueryClientProvider>,
  );
  const foot = view.getByTestId('drawer-foot');
  return {
    view,
    foot,
    texts: within(foot)
      .getAllByText(/.+/)
      .map((node) => node.props.children),
  };
}

it("ends the drawer with one block: the person's name, then Sign out, instead of a Logout item", async () => {
  mockProfile = { fullName: 'Ada Lovelace', email: 'ada@example.test' };
  const { view, foot, texts } = await footOf();

  expect(texts).toEqual(['Ada Lovelace', 'Sign out']);
  expect(within(foot).getByRole('button', { name: 'Sign out' })).toBeTruthy();
  expect(view.queryByText('ada@example.test')).toBeNull();
  expect(view.queryByText('Logout')).toBeNull();
});

it.each([
  ['no name', null],
  ['a blank name', '  '],
])('names the person by email in the foot when the profile has %s', async (_, fullName) => {
  mockProfile = { fullName, email: 'ada@example.test' };
  const { texts } = await footOf();

  expect(texts).toEqual(['ada@example.test', 'Sign out']);
});

it('shows Sign out alone in the foot while the profile is unknown', async () => {
  const { texts } = await footOf();

  expect(texts).toEqual(['Sign out']);
});

it('offers Help & Support as a footer link to the Help screen rather than a menu item', async () => {
  const { view } = await footOf();

  expect(view.queryByRole('button', { name: 'Help & Support' })).toBeNull();
  await fireEvent.press(view.getByRole('link', { name: 'Help & Support' }));
  expect(mockNavigate).toHaveBeenLastCalledWith('MainApp', { screen: 'Help' });
});

const companyList = (results: { uuid: string; name: string }[]) => ({
  data: { results, count: results.length, next: null, previous: null },
});

it('opens Company team through Home for an investor while the company work group is hidden', async () => {
  const view = await render(
    <QueryClientProvider client={client}>
      <DrawerNavigator />
    </QueryClientProvider>,
  );
  expect(view.queryByRole('button', { name: 'Register' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Company team' }));
  expect(mockNavigate).toHaveBeenCalledWith('MainApp', {
    screen: 'Main',
    params: { screen: 'Home', params: { screen: 'CompanyTeam' } },
  });
  expect(mockCompanies).not.toHaveBeenCalled();
});

function drawer() {
  return render(
    <QueryClientProvider client={client}>
      <DrawerNavigator />
    </QueryClientProvider>,
  );
}

it("puts a company's own group first, named after the company, and still gives it Your shares", async () => {
  mockRole = { isCompany: true, isInvestor: false, isLoading: false };
  mockCompanies.mockResolvedValue(companyList([{ uuid: 'company', name: 'Harbour Robotics Pty Ltd' }]));
  const view = await drawer();

  const group = await view.findByRole('header', { name: 'Harbour Robotics Pty Ltd' });
  expect(view.getAllByRole('header').map((header) => header.props.children)).toEqual([
    'Harbour Robotics Pty Ltd',
    'Your shares',
  ]);
  expect(group.props.numberOfLines).toBeUndefined();
  expect(view.queryByRole('header', { name: 'Company' })).toBeNull();
  const buttons = view.getAllByRole('button');
  const at = (name: string) => buttons.indexOf(view.getByRole('button', { name }));
  expect([at('Register'), at('Offerings'), at('Company')]).toEqual([0, 1, 2]);
});

const groupLabels = (view: Awaited<ReturnType<typeof drawer>>) =>
  view.getAllByRole('header').map((header) => header.props.children);

it("names the company group Company while the company's name is being read", async () => {
  mockRole = { isCompany: true, isInvestor: false, isLoading: false };
  const view = await drawer();

  await waitFor(() => expect(mockCompanies).toHaveBeenCalledTimes(1));
  expect(groupLabels(view)).toEqual(['Company', 'Your shares']);
});

it.each([
  ['cannot be read', () => Promise.reject(new Error('Synthetic company read failure'))],
  ['holds no company', () => Promise.resolve(companyList([]))],
  ['holds a company with a blank name', () => Promise.resolve(companyList([{ uuid: 'company', name: '' }]))],
])('names the company group Company once the company list %s', async (_, read) => {
  mockRole = { isCompany: true, isInvestor: false, isLoading: false };
  mockCompanies.mockImplementation(read);
  const view = await drawer();

  await waitFor(() => expect(client.getQueryState(['companies'])?.status).toMatch(/^(success|error)$/));
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  expect(groupLabels(view)).toEqual(['Company', 'Your shares']);
});

it('asks for the company only for an account with a company role', async () => {
  mockCompanies.mockResolvedValue(companyList([{ uuid: 'company', name: 'Harbour Robotics Pty Ltd' }]));
  const view = await drawer();

  expect(view.getByRole('header', { name: 'Invest' })).toBeTruthy();
  expect(mockCompanies).not.toHaveBeenCalled();
});

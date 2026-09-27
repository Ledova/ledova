import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { signout } from '@ledova/shared';
import { notificationsService } from '../services/notificationsService';
import { clearTokens } from '../services/tokenStorage';
import { DrawerNavigator } from './DrawerNavigator';

const mockReset = jest.fn();
const mockNavigate = jest.fn();
let mockRole = { isCompany: false, isInvestor: true, isLoading: false };
let mockTradingEnabled = false;
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ reset: mockReset, navigate: mockNavigate }) }));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({ Navigator: () => null, Screen: () => null }),
}));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  signout: jest.fn(),
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
jest.mock('../services/apiClient', () => ({ apiClient: {} }));
jest.mock('../services/notificationsService', () => ({ notificationsService: { unregisterToken: jest.fn() } }));
jest.mock('../services/tokenStorage', () => ({ clearTokens: jest.fn() }));

const account = ['account'];
let client: QueryClient;
let events: string[];

function cache() {
  return client.getQueryData(account) ? 'kept' : 'cleared';
}

beforeEach(() => {
  mockRole = { isCompany: false, isInvestor: true, isLoading: false };
  mockTradingEnabled = false;
  client = new QueryClient();
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

afterEach(() => {
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

  await fireEvent.press(view.getByText('Logout'));
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

  await fireEvent.press(view.getByText('Logout'));
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
  expect(Boolean(view.queryByRole('button', { name: 'Application' }))).toBe(isCompany);
  expect(Boolean(view.queryByRole('button', { name: 'Register' }))).toBe(isCompany);
  expect(Boolean(view.queryByRole('button', { name: 'Publications' }))).toBe(isCompany);
  expect(Boolean(view.queryByRole('header', { name: 'Invest' }))).toBe(isInvestor);
  expect(Boolean(view.queryByRole('button', { name: 'Market' }))).toBe(isInvestor);
  expect(Boolean(view.queryByRole('button', { name: 'Verification' }))).toBe(isInvestor);
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
    await fireEvent.press(view.getByRole('button', { name: 'Publications' }));
    expect(mockNavigate).toHaveBeenLastCalledWith('MainApp', {
      screen: 'Main',
      params: { screen: 'Company', params: { screen: 'CompanyPublications' } },
    });
  }
  if (isInvestor) {
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

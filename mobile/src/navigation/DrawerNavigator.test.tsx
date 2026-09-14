import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { signout } from '@ledova/shared';
import { notificationsService } from '../services/notificationsService';
import { clearTokens } from '../services/tokenStorage';
import { DrawerNavigator } from './DrawerNavigator';

const mockReset = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ reset: mockReset, navigate: jest.fn() }) }));
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
jest.mock('../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ isEnabled: () => false }) }));
jest.mock('../hooks/useRole', () => ({ useRole: () => ({ isCompany: false }) }));
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

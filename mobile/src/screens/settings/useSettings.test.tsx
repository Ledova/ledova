import React from 'react';
import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { deleteAccount } from '@ledova/shared';
import { clearTokens } from '../../services/tokenStorage';
import { useSettings } from './useSettings';

const mockReset = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ reset: mockReset }) }));
jest.mock('@ledova/shared', () => ({ ...jest.requireActual('@ledova/shared'), deleteAccount: jest.fn() }));
jest.mock('../../services/apiClient', () => ({ apiClient: {} }));
jest.mock('../../services/tokenStorage', () => ({ clearTokens: jest.fn() }));

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
  mockReset.mockImplementation(() => events.push(`navigate with cache ${cache()}`));
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  client.clear();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function deleteThroughSettings() {
  const { result } = await renderHook(() => useSettings(), { wrapper });
  let deleted: boolean | undefined;
  await act(async () => {
    deleted = await result.current.deleteUserAccount();
  });
  return { deleted, deleting: result.current.isDeleting };
}

it.each([
  ['confirmed', undefined, []],
  [
    'unconfirmed',
    new Error('synthetic storage detail'),
    [
      [
        'Account Deleted',
        'Your account was deleted, but this device could not confirm that your saved sign-in was removed.',
      ],
    ],
  ],
])('completes a deletion the server accepted when local retirement is %s', async (_, failure, alerts) => {
  jest.mocked(deleteAccount).mockResolvedValue({} as Awaited<ReturnType<typeof deleteAccount>>);
  jest.mocked(clearTokens).mockImplementation(async () => {
    events.push(`retire with cache ${cache()}`);
    if (failure) throw failure;
  });

  await expect(deleteThroughSettings()).resolves.toEqual({ deleted: true, deleting: false });
  expect(events).toEqual(['retire with cache kept', 'navigate with cache cleared']);
  expect(mockReset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'SignIn' }] });
  expect(jest.mocked(Alert.alert).mock.calls).toEqual(alerts);
});

it('reports a deletion the server refused and keeps the session', async () => {
  jest.mocked(deleteAccount).mockRejectedValue(new Error('synthetic refusal'));

  await expect(deleteThroughSettings()).resolves.toEqual({ deleted: false, deleting: false });
  expect(clearTokens).not.toHaveBeenCalled();
  expect(events).toEqual([]);
  expect(cache()).toBe('kept');
  expect(jest.mocked(Alert.alert).mock.calls).toEqual([
    ['Delete Failed', 'Unable to delete your account. Please try again later.'],
  ]);
});

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { AccountTypeScreen } from './AccountTypeScreen';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('../../../services/apiClient', () => ({ apiClient: { get: jest.fn(), patch: jest.fn() } }));
const api = jest.mocked(apiClient);

let client: QueryClient;

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
  api.get.mockResolvedValue({ data: { uuid: 'account-1', role: 'investor' } });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

async function screen() {
  const view = await render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <AccountTypeScreen />
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(view.getByText('Individual Investor')).toBeEnabled());
  return view;
}

it('says why the account type was not saved and keeps the person on the step', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.patch.mockRejectedValue({
    response: { status: 409, data: { detail: 'Account type can no longer be changed.' } },
  });
  const view = await screen();

  await fireEvent.press(view.getByText('Company Representative'));

  await waitFor(() => expect(view.getByText('Account type can no longer be changed.')).toBeTruthy());
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('moves on once the account type is saved', async () => {
  api.patch.mockResolvedValue({ data: { uuid: 'account-1', role: 'investor' } });
  const view = await screen();

  await fireEvent.press(view.getByText('Individual Investor'));

  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('PreScreening'));
  expect(view.queryByText('We could not save your account type. Please try again.')).toBeNull();
});

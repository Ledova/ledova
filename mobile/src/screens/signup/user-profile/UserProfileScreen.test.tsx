import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiClientProvider, USER_PROFILE_FIELDS } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { UserProfileScreen } from './UserProfileScreen';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../../../hooks/useRole', () => ({ useRole: () => ({ isCompany: false }) }));
jest.mock('../../../services/apiClient', () => ({ apiClient: { get: jest.fn(), patch: jest.fn() } }));
const api = jest.mocked(apiClient);

const A_MESSAGE: Record<string, string> = {
  fullName: 'Enter your full legal name.',
  dateOfBirth: 'Enter a date in the past.',
  residentialAddress: 'Enter a street address.',
  phoneNumber: 'Enter a valid phone number.',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.get.mockResolvedValue({
    data: {
      count: 1,
      results: [
        {
          uuid: 'profile-1',
          fullName: 'Synthetic Person',
          dateOfBirth: '1990-01-01',
          residentialAddress: '1 Synthetic Street, Sydney',
          phoneCountryCode: '+61',
          phoneNumber: '491570156',
        },
      ],
    },
  });
});

afterEach(async () => {
  await cleanup();
});

describe('every field USER_PROFILE_FIELDS names is one this screen actually renders', () => {
  it.each(USER_PROFILE_FIELDS)('shows the refusal the server gave for %s under its field', async (field) => {
    api.patch.mockRejectedValue({ response: { status: 400, data: { [field]: [A_MESSAGE[field]] } } });
    const view = await render(
      <ApiClientProvider client={apiClient}>
        <UserProfileScreen />
      </ApiClientProvider>,
    );
    await waitFor(() => expect(view.getByDisplayValue('Synthetic Person')).toBeTruthy());

    await fireEvent.press(view.getByText('Continue'));

    await waitFor(() => expect(view.getByText(A_MESSAGE[field])).toBeTruthy());
  });
});

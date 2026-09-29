import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiClientProvider, FINANCIAL_PROFILE_FIELDS } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { FinancialProfileScreen } from './FinancialProfileScreen';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../../../services/apiClient', () => ({ apiClient: { get: jest.fn(), patch: jest.fn(), post: jest.fn() } }));
const api = jest.mocked(apiClient);

const A_MESSAGE: Record<string, string> = {
  sourceOfFunds: 'Choose at least one source of funds.',
  sourceOfFundsOtherText: 'Describe the other source in fewer words.',
  intendedUse: 'Choose how you will use the platform.',
  intendedUseOtherText: 'Describe the other use in fewer words.',
  occupation: 'Ensure this field has no more than 200 characters.',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.get.mockImplementation((url: string) => {
    if (url === '/api/user-profiles/') return Promise.resolve({ data: { count: 1, results: [{ uuid: 'profile-1' }] } });
    if (url === '/api/financial-profiles/')
      return Promise.resolve({
        data: {
          count: 1,
          results: [
            {
              uuid: 'financial-1',
              occupation: 'Engineer',
              sourceOfFunds: ['savings', 'other'],
              sourceOfFundsOtherText: 'Consulting',
              intendedUse: 'other',
              intendedUseOtherText: 'Research',
            },
          ],
        },
      });
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
});

describe('every field FINANCIAL_PROFILE_FIELDS names is one this screen actually renders', () => {
  it.each(FINANCIAL_PROFILE_FIELDS)('shows the refusal the server gave for %s under its field', async (field) => {
    api.patch.mockRejectedValue({ response: { status: 400, data: { [field]: [A_MESSAGE[field]] } } });
    const view = await render(
      <ApiClientProvider client={apiClient}>
        <FinancialProfileScreen />
      </ApiClientProvider>,
    );
    await waitFor(() => expect(view.getByDisplayValue('Engineer')).toBeTruthy());

    await fireEvent.press(view.getByText('Continue'));

    await waitFor(() => expect(view.getByText(A_MESSAGE[field])).toBeTruthy());
  });
});

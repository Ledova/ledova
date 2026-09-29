import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiClientProvider, EMAIL_VERIFICATION_FIELDS } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { EmailConfirmationScreen } from './EmailConfirmationScreen';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../../../services/apiClient', () => ({ apiClient: { post: jest.fn() } }));
jest.mock('../../../services/tokenStorage', () => ({ storeTokens: jest.fn() }));
const api = jest.mocked(apiClient);

const A_MESSAGE: Record<string, string> = { token: 'Invalid email or verification code.' };

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await AsyncStorage.setItem('signup_email', 'synthetic@example.test');
});

afterEach(async () => {
  await cleanup();
  await AsyncStorage.clear();
});

describe('every field EMAIL_VERIFICATION_FIELDS names is one this screen actually renders', () => {
  it.each(EMAIL_VERIFICATION_FIELDS)('shows the refusal the server gave for %s under its field', async (field) => {
    api.post.mockRejectedValue({ response: { status: 400, data: { [field]: [A_MESSAGE[field]] } } });
    const view = await render(
      <ApiClientProvider client={apiClient}>
        <EmailConfirmationScreen />
      </ApiClientProvider>,
    );
    await fireEvent.changeText(view.getByPlaceholderText('000000'), '123456');

    await fireEvent.press(view.getByText('Verify'));

    await waitFor(() => expect(view.getByText(A_MESSAGE[field])).toBeTruthy());
  });
});

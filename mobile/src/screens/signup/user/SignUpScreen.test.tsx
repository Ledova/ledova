import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiClientProvider, SIGNUP_USER_FIELDS } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { SignUpScreen } from './SignUpScreen';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('../../../services/apiClient', () => ({ apiClient: { post: jest.fn() } }));
const api = jest.mocked(apiClient);

const A_MESSAGE: Record<string, string> = {
  email: 'A user with that email already exists.',
  password: 'This password is too common.',
};

beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await AsyncStorage.clear();
});

afterEach(async () => {
  await cleanup();
});

async function filledIn() {
  const view = await render(
    <ApiClientProvider client={apiClient}>
      <SignUpScreen />
    </ApiClientProvider>,
  );
  await fireEvent.changeText(view.getByLabelText('Email'), 'synthetic@example.test');
  await fireEvent.changeText(view.getByLabelText('Password'), 'long enough');
  return view;
}

it('keeps the email for the confirmation step under signup_email, where that step reads it, then moves on', async () => {
  api.post.mockResolvedValue({ data: {} });
  const view = await filledIn();

  await fireEvent.press(view.getByText('Continue'));

  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('EmailConfirmation'));
  expect(await AsyncStorage.getItem('signup_email')).toBe('synthetic@example.test');
});

it('shows the refusal the backend sends for a registered email under the field, as it stands', async () => {
  api.post.mockRejectedValue({ response: { status: 400, data: { email: ['Email already registered'] } } });
  const view = await filledIn();

  await fireEvent.press(view.getByText('Continue'));

  await waitFor(() => expect(view.getByText('Email already registered')).toBeTruthy());
  expect(mockNavigate).not.toHaveBeenCalled();
});

describe('every field SIGNUP_USER_FIELDS names is one this screen actually renders', () => {
  it.each(SIGNUP_USER_FIELDS)('shows the refusal the server gave for %s under its field', async (field) => {
    api.post.mockRejectedValue({ response: { status: 400, data: { [field]: [A_MESSAGE[field]] } } });
    const view = await filledIn();

    await fireEvent.press(view.getByText('Continue'));

    await waitFor(() => expect(view.getByText(A_MESSAGE[field])).toBeTruthy());
  });
});

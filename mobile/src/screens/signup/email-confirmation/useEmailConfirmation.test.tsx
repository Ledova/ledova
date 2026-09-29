import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { ApiClientProvider, AUTH_ENDPOINTS } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { storeTokens } from '../../../services/tokenStorage';
import { useEmailConfirmation } from './useEmailConfirmation';

jest.mock('../../../services/apiClient', () => ({ apiClient: { post: jest.fn() } }));
jest.mock('../../../services/tokenStorage', () => ({ storeTokens: jest.fn() }));

const post = jest.mocked(apiClient.post);

function wrapper({ children }: { children: React.ReactNode }) {
  return <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>;
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('verifies the email saved at sign-up and keeps the session it answers with before moving on', async () => {
  await AsyncStorage.setItem('signup_email', 'synthetic@example.test');
  const steps: string[] = [];
  jest.mocked(storeTokens).mockImplementation(async () => {
    await Promise.resolve();
    steps.push('stored');
  });
  post.mockResolvedValue({ data: { tokens: [{ accessToken: 'access', refreshToken: 'refresh' }] } });
  const { result } = await renderHook(() => useEmailConfirmation(), { wrapper });
  await waitFor(() => expect(result.current.email).toBe('synthetic@example.test'));
  await act(async () => result.current.setVerificationCode('123456'));

  await act(() => result.current.handleVerify(() => steps.push('moved on')));

  expect(post).toHaveBeenCalledWith(AUTH_ENDPOINTS.EMAIL_VERIFICATION, {
    email: 'synthetic@example.test',
    token: '123456',
  });
  expect(storeTokens).toHaveBeenCalledWith({ accessToken: 'access', refreshToken: 'refresh' });
  expect(steps).toEqual(['stored', 'moved on']);
});

it('stays on the step when the session cannot be kept', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.mocked(storeTokens).mockRejectedValue(new Error('Session storage did not complete.'));
  post.mockResolvedValue({ data: { tokens: [{ accessToken: 'access', refreshToken: 'refresh' }] } });
  const moveOn = jest.fn();
  const { result } = await renderHook(() => useEmailConfirmation(), { wrapper });
  await act(async () => result.current.setVerificationCode('123456'));

  await act(() => result.current.handleVerify(moveOn));

  expect(moveOn).not.toHaveBeenCalled();
  expect(result.current.generalError).not.toBe('');
});

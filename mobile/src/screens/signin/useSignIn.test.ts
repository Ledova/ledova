import { AxiosError, AxiosHeaders } from 'axios';
import { act, renderHook } from '@testing-library/react-native';
import { createUserFriendlyError } from '@ledova/shared';
import { rotateRefreshToken } from '../../services/apiClient';
import { useSignIn } from './useSignIn';

jest.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ refetch: jest.fn() }) }));
jest.mock('../../services/apiClient', () => ({ apiClient: {}, rotateRefreshToken: jest.fn() }));
jest.mock('../../services/notificationsService', () => ({ notificationsService: { registerToken: jest.fn() } }));
jest.mock('../../services/tokenStorage', () => ({ storeTokens: jest.fn() }));

const expired = 'Your saved sign in has expired. Please sign in with your password.';
const unavailable = 'Biometric sign in is temporarily unavailable. Please try again.';

function failure(status: number, data = {}) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('Synthetic refresh failure', 'ERR_BAD_REQUEST', config, undefined, {
    data,
    status,
    statusText: '',
    headers: new AxiosHeaders(),
    config,
  });
}

it.each([
  ['a 400 refusal', failure(400), expired],
  ['a 401 refusal', failure(401), expired],
  ['a 429 response', failure(429), unavailable],
  ['a 503 response with detail', failure(503, { detail: 'Synthetic service detail' }), unavailable],
  ['a user-friendly failure', createUserFriendlyError('Synthetic friendly message'), 'Synthetic friendly message'],
])('shows the biometric sign in message for %s', async (_, error, message) => {
  jest.mocked(rotateRefreshToken).mockRejectedValue(error);
  const { result } = await renderHook(() => useSignIn());
  const signedIn = await act(() => result.current.loginWithRefreshToken('synthetic-refresh'));
  expect({ signedIn, message: result.current.generalError, loading: result.current.isLoading }).toEqual({
    signedIn: false,
    message,
    loading: false,
  });
});

import { signin } from '@ledova/shared';
import { act, renderHook } from '@testing-library/react-native';
import { storeTokens } from '../../services/tokenStorage';
import { useSignIn } from './useSignIn';

const mockRefetch = jest.fn();
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  signin: jest.fn(),
  useAuth: () => ({ refetch: mockRefetch }),
}));
jest.mock('../../services/apiClient', () => ({ apiClient: {} }));
jest.mock('../../services/notificationsService', () => ({
  notificationsService: { registerToken: jest.fn().mockResolvedValue(true) },
}));
jest.mock('../../services/tokenStorage', () => ({ storeTokens: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockRefetch.mockResolvedValue({});
});

it('stores the returned token pair and refreshes authentication before completing sign-in', async () => {
  jest.mocked(signin).mockResolvedValue({
    data: { tokens: [{ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' }] },
  } as Awaited<ReturnType<typeof signin>>);
  const { result } = await renderHook(() => useSignIn());
  const success = jest.fn();
  await act(async () => result.current.setFieldValue('email', 'member@example.test'));
  await act(async () => result.current.setFieldValue('password', 'synthetic-password'));
  await act(async () => result.current.handleSubmit(success));
  expect(signin).toHaveBeenCalledWith({}, { email: 'member@example.test', password: 'synthetic-password' });
  expect(storeTokens).toHaveBeenCalledWith({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' });
  expect(mockRefetch).toHaveBeenCalledTimes(1);
  expect(success).toHaveBeenCalledTimes(1);
  expect(jest.mocked(storeTokens).mock.invocationCallOrder[0]).toBeLessThan(mockRefetch.mock.invocationCallOrder[0]);
  expect(mockRefetch.mock.invocationCallOrder[0]).toBeLessThan(success.mock.invocationCallOrder[0]);
});

it('keeps refused credentials signed out and does not store a token', async () => {
  jest.mocked(signin).mockRejectedValue({ response: { status: 401, data: { detail: 'Invalid credentials.' } } });
  const { result } = await renderHook(() => useSignIn());
  const success = jest.fn();
  await act(async () => result.current.setFieldValue('email', 'member@example.test'));
  await act(async () => result.current.setFieldValue('password', 'synthetic-password'));
  await act(async () => result.current.handleSubmit(success));
  expect(result.current.generalError).toBe('Invalid credentials.');
  expect(result.current.isLoading).toBe(false);
  expect(storeTokens).not.toHaveBeenCalled();
  expect(mockRefetch).not.toHaveBeenCalled();
  expect(success).not.toHaveBeenCalled();
});

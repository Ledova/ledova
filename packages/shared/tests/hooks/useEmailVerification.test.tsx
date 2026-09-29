/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { AUTH_ENDPOINTS } from '../../src/constants/api';
import { useEmailVerification } from '../../src/hooks/useEmailVerification';
import { deferred, providers, signupApi } from '../fixtures/signup';

const api = signupApi();
const wrapper = providers(api);
const verified = { data: { tokens: [{ accessToken: 'access', refreshToken: 'refresh' }] } };

beforeEach(() => {
  jest.clearAllMocks();
  api.post.mockResolvedValue(verified);
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

it('verifies the code for the email it is given and moves on only once the client has used the answer', async () => {
  const finished = deferred<void>();
  const onVerified = jest.fn(() => finished.promise);
  const moveOn = jest.fn();
  const { result } = renderHook(() => useEmailVerification('synthetic@example.test', onVerified), { wrapper });
  act(() => result.current.setVerificationCode('123456'));

  let verifying: Promise<void> = Promise.resolve();
  act(() => {
    verifying = result.current.handleVerify(moveOn);
  });
  await waitFor(() => expect(onVerified).toHaveBeenCalledWith(verified));

  expect(api.post).toHaveBeenCalledWith(AUTH_ENDPOINTS.EMAIL_VERIFICATION, {
    email: 'synthetic@example.test',
    token: '123456',
  });
  expect(moveOn).not.toHaveBeenCalled();

  await act(async () => {
    finished.resolve();
    await verifying;
  });
  expect(moveOn).toHaveBeenCalledTimes(1);
  expect(result.current.isLoading).toBe(false);
});

it('asks for the whole code before calling the server', async () => {
  const onVerified = jest.fn();
  const { result } = renderHook(() => useEmailVerification('synthetic@example.test', onVerified), { wrapper });
  act(() => result.current.setVerificationCode('123'));

  await act(() => result.current.handleVerify(jest.fn()));

  expect(result.current.errors).toEqual({ token: ['Please enter a valid 6-digit verification code'] });
  expect(api.post).not.toHaveBeenCalled();
  expect(onVerified).not.toHaveBeenCalled();
});

it('shows the refusal, does not move on, and logs the failure without its body', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.post.mockRejectedValue({
    response: { status: 400, data: { token: ['This code has expired.'] } },
    config: { method: 'post', url: AUTH_ENDPOINTS.EMAIL_VERIFICATION },
  });
  const onVerified = jest.fn();
  const moveOn = jest.fn();
  const { result } = renderHook(() => useEmailVerification('synthetic@example.test', onVerified), { wrapper });
  act(() => result.current.setVerificationCode('123456'));

  await act(() => result.current.handleVerify(moveOn));

  expect(result.current.errors).toEqual({ token: ['This code has expired.'] });
  expect(result.current.generalError).toBe('This code has expired.');
  expect(console.error).toHaveBeenCalledWith(
    `Email verification failed: status=400 request=POST ${AUTH_ENDPOINTS.EMAIL_VERIFICATION}`,
  );
  expect(onVerified).not.toHaveBeenCalled();
  expect(moveOn).not.toHaveBeenCalled();
});

it('resends to the same email, says so, and clears the code typed so far', async () => {
  const { result } = renderHook(() => useEmailVerification('synthetic@example.test', jest.fn()), { wrapper });
  act(() => result.current.setVerificationCode('123'));

  await act(() => result.current.handleResend());

  expect(api.post).toHaveBeenLastCalledWith(AUTH_ENDPOINTS.RESEND_VERIFICATION, { email: 'synthetic@example.test' });
  expect(result.current.successMessage).toBe('Verification code sent! Please check your email.');
  expect(result.current.verificationCode).toBe('');
  expect(result.current.isResending).toBe(false);
});

it('says the code could not be resent and logs why', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.post.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useEmailVerification('synthetic@example.test', jest.fn()), { wrapper });

  await act(() => result.current.handleResend());

  expect(result.current.generalError).toBe('Failed to resend code. Please try again.');
  expect(result.current.successMessage).toBe('');
  expect(console.error).toHaveBeenCalledWith('Failed to resend verification code: Error: offline');
});

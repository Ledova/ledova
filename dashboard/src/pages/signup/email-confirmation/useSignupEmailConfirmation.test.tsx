// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AUTH_ENDPOINTS } from '@ledova/shared';
import { useSignupEmailConfirmation } from './useSignupEmailConfirmation';

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  api.post.mockResolvedValue({ data: {} });
});

afterEach(cleanup);

it('verifies and resends for the email saved at signup', async () => {
  localStorage.setItem('signup_email', 'synthetic@example.test');
  const { result } = renderHook(() => useSignupEmailConfirmation());
  expect(result.current.email).toBe('synthetic@example.test');
  act(() => result.current.setVerificationCode('123456'));
  const verified = vi.fn();
  await act(() => result.current.handleVerify(verified));
  expect(api.post).toHaveBeenCalledWith(AUTH_ENDPOINTS.EMAIL_VERIFICATION, {
    email: 'synthetic@example.test',
    token: '123456',
  });
  expect(verified).toHaveBeenCalledOnce();
  expect(localStorage.getItem('signup_email')).toBeNull();
  await act(() => result.current.handleResend());
  expect(api.post).toHaveBeenLastCalledWith(AUTH_ENDPOINTS.RESEND_VERIFICATION, { email: 'synthetic@example.test' });
});

it('starts with no email when signup saved none', () => {
  const { result } = renderHook(() => useSignupEmailConfirmation());
  expect(result.current.email).toBe('');
});

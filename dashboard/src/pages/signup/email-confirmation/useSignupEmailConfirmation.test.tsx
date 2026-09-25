// @vitest-environment jsdom

import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AUTH_ENDPOINTS } from '@ledova/shared';
import { AUTH_QUERY_KEY } from '@hooks/useAuth';
import { useSignupEmailConfirmation } from './useSignupEmailConfirmation';

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

let client: QueryClient;

function renderConfirmation() {
  client = new QueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSignupEmailConfirmation(), { wrapper });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  api.post.mockResolvedValue({ data: {} });
});

afterEach(() => {
  cleanup();
  client.clear();
});

it('verifies and resends for the email saved at signup', async () => {
  localStorage.setItem('signup_email', 'synthetic@example.test');
  const { result } = renderConfirmation();
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

it('moves on only once the session answer says signed in, since verification signs the account in', async () => {
  const { result } = renderConfirmation();
  let release: () => void = () => {};
  const refetch = vi.spyOn(client, 'refetchQueries').mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  act(() => result.current.setVerificationCode('123456'));
  const verified = vi.fn();

  let verifying: Promise<void> = Promise.resolve();
  act(() => {
    verifying = result.current.handleVerify(verified);
  });
  await vi.waitFor(() => expect(refetch).toHaveBeenCalledWith({ queryKey: AUTH_QUERY_KEY, exact: true }));
  expect(verified).not.toHaveBeenCalled();

  await act(async () => {
    release();
    await verifying;
  });
  expect(verified).toHaveBeenCalledOnce();
});

it('starts with no email when signup saved none', () => {
  const { result } = renderConfirmation();
  expect(result.current.email).toBe('');
});

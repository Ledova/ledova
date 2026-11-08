// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AUTH_QUERY_KEY, confirmPasswordReset, requestPasswordReset, signin } from '@ledova/shared';
import { expect, it, vi } from 'vitest';
import apiClient from '@services/apiClient';
import PasswordResetPage from '.';

vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
  signin: vi.fn(),
}));

it('requests a neutral reset and uses a memory-only link to change the password without signing in', async () => {
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(requestPasswordReset).mockResolvedValue({ data: {} } as never);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function showPage() {
    return render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <PasswordResetPage />
          </BrowserRouter>
        </QueryClientProvider>
      </StrictMode>,
    );
  }
  window.history.replaceState(null, '', '/reset-password');
  const view = showPage();
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  expect(requestPasswordReset).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'member@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('If an eligible account exists'));
  expect(requestPasswordReset).toHaveBeenCalledExactlyOnceWith(apiClient, { email: 'member@example.test' });
  queryClient.setQueryData(['userProfiles'], { data: { results: [{ uuid: 'old-account' }] } });
  queryClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  await act(async () => {
    window.location.hash = 'uid=demo-user&token=demo-proof';
  });
  await waitFor(() => expect(screen.getByLabelText('New password')).toBeTruthy());
  expect(window.location.hash).toBe('');
  expect(screen.queryByLabelText('Email')).toBeNull();
  expect(confirmPasswordReset).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Request a new link' }));
  expect(screen.getByLabelText('Email')).toBeTruthy();
  await act(async () => {
    window.location.hash = 'uid=demo-user&token=demo-proof';
  });
  await waitFor(() => expect(screen.getByLabelText('New password')).toBeTruthy());
  expect(window.location.hash).toBe('');
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'tiny' } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
  expect(confirmPasswordReset).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: '        ' } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: '        ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
  expect(confirmPasswordReset).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a different secret password' } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a different secret password' } });
  vi.mocked(confirmPasswordReset).mockRejectedValueOnce({
    response: { status: 400, data: { newPassword: ['Choose a less common password.'] } },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
  await waitFor(() => expect(screen.getAllByText('Choose a less common password.').length).toBeGreaterThan(0));

  let finish!: (value: never) => void;
  vi.mocked(confirmPasswordReset).mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'another secure sample password' } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: 'another secure sample password' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
  expect(screen.getByRole('button', { name: 'Resetting password…' }).hasAttribute('disabled')).toBe(true);
  expect(confirmPasswordReset).toHaveBeenLastCalledWith(apiClient, {
    uid: 'demo-user',
    token: 'demo-proof',
    newPassword: 'another secure sample password',
  });
  await act(async () => {
    window.location.hash = 'uid=another-user&token=another-proof';
  });
  await waitFor(() => expect(screen.getByLabelText('New password').getAttribute('value')).toBe(''));
  await act(async () => finish({ data: {} } as never));
  expect(screen.queryByRole('status')).toBeNull();
  expect(queryClient.getQueryData(['userProfiles'])).toBeUndefined();
  vi.mocked(confirmPasswordReset).mockResolvedValueOnce({ data: {} } as never);
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: ' another secure sample password ' } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: ' another secure sample password ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Sign in with your new password'));
  expect(confirmPasswordReset).toHaveBeenLastCalledWith(apiClient, {
    uid: 'another-user',
    token: 'another-proof',
    newPassword: ' another secure sample password ',
  });
  expect(screen.getByRole('status').textContent).toContain('Sign in with your new password');
  expect(screen.queryByLabelText('New password')).toBeNull();
  expect(queryClient.getQueryData(['userProfiles'])).toBeUndefined();
  expect(signin).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/signin');
  expect(localStorage).toHaveLength(0);
  expect(sessionStorage).toHaveLength(0);
  expect(document.body.textContent).not.toContain('demo-proof');
  view.unmount();
  queryClient.clear();
  window.history.replaceState(null, '', '/');
});

// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider, AUTH_ENDPOINTS, USER_PROFILE_ENDPOINTS } from '@ledova/shared';

import { AUTH_QUERY_KEY } from '@hooks/useAuth';
import { SignupEmailConfirmation } from '@pages/signup/email-confirmation';
import apiClient from '@services/apiClient';
import { SIGNUP_STEPS, signupRoutes, type SignupStep } from './signupRoutes';

vi.mock('@services/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

let signedIn = false;
let client: QueryClient;

function Step({ name }: { name: string }) {
  const [value, setValue] = useState('');
  return (
    <label>
      {name}
      <input value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}

function openSignup(address: SignupStep, pages: Partial<Record<SignupStep, ReactElement>> = {}) {
  const steps = Object.fromEntries(
    SIGNUP_STEPS.map((path) => [path, pages[path] ?? <Step key={path} name={path} />]),
  ) as Record<SignupStep, ReactElement>;
  render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <MemoryRouter initialEntries={[address]}>
          <Routes>{signupRoutes(steps)}</Routes>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

describe('sign-up across the moment email verification signs the account in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    signedIn = false;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(apiClient.get).mockImplementation(((url: string) => {
      if (url === AUTH_ENDPOINTS.VERIFY) return Promise.resolve({ data: { valid: signedIn } });
      if (url === USER_PROFILE_ENDPOINTS.BASE) {
        return signedIn
          ? Promise.resolve({ data: { count: 1, results: [{ uuid: 'profile-1', isSignupCompleted: false }] } })
          : new Promise(() => {});
      }
      return Promise.resolve({ data: { uuid: 'account-1', role: 'investor' } });
    }) as typeof apiClient.get);
    vi.mocked(apiClient.post).mockImplementation(((url: string) => {
      if (url === AUTH_ENDPOINTS.EMAIL_VERIFICATION) signedIn = true;
      return Promise.resolve({ data: {} });
    }) as typeof apiClient.post);
  });

  afterEach(() => {
    cleanup();
    client.clear();
  });

  it('asks for no profile while signed out, and shows the step at once', async () => {
    openSignup('/signup/email-confirmation');

    expect(await screen.findByLabelText('/signup/email-confirmation')).toBeTruthy();
    expect(apiClient.get).toHaveBeenCalledWith(AUTH_ENDPOINTS.VERIFY);
    expect(apiClient.get).not.toHaveBeenCalledWith(USER_PROFILE_ENDPOINTS.BASE);
  });

  it('keeps the next step, and what was typed in it, when the session answer is refreshed', async () => {
    localStorage.setItem('signup_email', 'synthetic@example.test');
    openSignup('/signup/email-confirmation', { '/signup/email-confirmation': <SignupEmailConfirmation /> });

    fireEvent.change(await screen.findByPlaceholderText('Enter verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    fireEvent.change(await screen.findByLabelText('/signup/account-type'), { target: { value: 'Ada Lovelace' } });

    await act(() => client.refetchQueries({ queryKey: AUTH_QUERY_KEY, exact: true }));
    await waitFor(() => expect(client.isFetching()).toBe(0));

    expect(((await screen.findByLabelText('/signup/account-type')) as HTMLInputElement).value).toBe('Ada Lovelace');
  });
});

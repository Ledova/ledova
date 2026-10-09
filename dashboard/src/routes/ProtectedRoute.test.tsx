// @vitest-environment jsdom

import type { PropsWithChildren, ReactNode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiClientProvider,
  CACHE_TIMING,
  AUTH_QUERY_KEY,
  AUTH_ENDPOINTS,
  USER_PROFILE_ENDPOINTS,
  USER_ACCOUNT_ENDPOINTS,
  USER_PREFERENCES_QUERY_KEY,
} from '@ledova/shared';

import { useSignupFinished } from '@hooks/useSignupFinished';
import apiClient from '@services/apiClient';
import { InSignedInFrame } from '@components/InSignedInFrame';
import { ProtectedRoute } from './ProtectedRoute';

vi.mock('@services/apiClient', () => ({ default: { get: vi.fn() } }));

let client: QueryClient;

function AsTheFrameDecides({ children }: PropsWithChildren) {
  return <InSignedInFrame.Provider value={useSignupFinished()}>{children}</InSignedInFrame.Provider>;
}

function inFrame(children: ReactNode, frameShowing?: boolean) {
  return frameShowing === undefined ? (
    <AsTheFrameDecides>{children}</AsTheFrameDecides>
  ) : (
    <InSignedInFrame.Provider value={frameShowing}>{children}</InSignedInFrame.Provider>
  );
}

function renderGuard(valid: boolean, stale = true, frameShowing?: boolean) {
  client.setQueryData(
    AUTH_QUERY_KEY,
    { data: { valid } },
    {
      updatedAt: Date.now() - (stale ? CACHE_TIMING.DEFAULT_STALE_TIME + 1000 : 0),
    },
  );
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'profile', userAccount: { uuid: 'account', role: 'investor' } },
  });
  render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        {inFrame(
          <MemoryRouter initialEntries={['/protected']}>
            <Routes>
              <Route
                path="/protected"
                element={
                  <ProtectedRoute audience="everyone">
                    <p>Protected content</p>
                  </ProtectedRoute>
                }
              />
              <Route path="/signin" element={<p>Sign in</p>} />
            </Routes>
          </MemoryRouter>,
          frameShowing,
        )}
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

function holdVerification() {
  let resolve!: (valid: boolean) => void;
  let reject!: (reason: Error) => void;
  const verification = new Promise((succeed, fail) => {
    resolve = (valid) => succeed({ data: { valid } });
    reject = fail;
  });
  vi.mocked(apiClient.get).mockImplementation(((url: string) =>
    url === AUTH_ENDPOINTS.VERIFY ? verification : accountRead(url)) as typeof apiClient.get);
  return { resolve, reject };
}

function accountRead(url: string) {
  if (url === USER_PROFILE_ENDPOINTS.BASE)
    return Promise.resolve({ data: { results: [{ uuid: 'profile', isSignupCompleted: true }] } });
  if (url === USER_ACCOUNT_ENDPOINTS.BASE) return Promise.resolve({ data: { uuid: 'account', role: 'investor' } });
  throw new Error(`Unexpected GET ${url}`);
}

describe('a protected route checks an auth correction before redirecting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    vi.mocked(apiClient.get).mockImplementation(accountRead as typeof apiClient.get);
  });

  afterEach(() => {
    cleanup();
    client.clear();
  });

  it('keeps protected content hidden until a stale negative has been corrected', async () => {
    const verification = holdVerification();
    renderGuard(false);

    expect(screen.getByRole('status', { name: 'Checking your session' })).toBeTruthy();
    expect(screen.queryByText('Sign in')).toBeNull();
    expect(screen.queryByText('Protected content')).toBeNull();
    await act(async () => verification.resolve(true));

    await waitFor(() => expect(screen.getByText('Protected content')).toBeTruthy());
    expect(screen.queryByText('Sign in')).toBeNull();
  });

  it('redirects after a fresh answer confirms the visitor is signed out', async () => {
    const verification = holdVerification();
    renderGuard(false);

    expect(screen.queryByText('Sign in')).toBeNull();
    await act(async () => verification.resolve(false));

    await waitFor(() => expect(screen.getByText('Sign in')).toBeTruthy());
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('leaves the loading state when verification fails and grants no access', async () => {
    const verification = holdVerification();
    renderGuard(false);

    expect(screen.queryByText('Sign in')).toBeNull();
    await act(async () => verification.reject(new Error('Network unavailable')));

    await waitFor(() => expect(screen.getByText('Sign in')).toBeTruthy());
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Protected content')).toBeNull();
  });

  it('redirects immediately on a current negative with no request in flight', () => {
    renderGuard(false, false);

    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('keeps an authenticated page mounted while its cached positive is rechecked', async () => {
    const verification = holdVerification();
    renderGuard(true);

    expect(await screen.findByText('Protected content')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => verification.resolve(true));
    expect(screen.getByText('Protected content')).toBeTruthy();
  });

  it('keeps a page it would admit behind the session check until the signed-in frame is showing', () => {
    renderGuard(true, false, false);

    expect(screen.getByRole('status', { name: 'Checking your session' })).toBeTruthy();
    expect(screen.queryByText('Protected content')).toBeNull();
    expect(screen.queryByText('Sign in')).toBeNull();
  });
});

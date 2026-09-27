// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PUBLICATION_COPY, type AccountRole } from '@ledova/shared';
import { InSignedInFrame } from '@components/InSignedInFrame';
import { useAuth } from '@hooks/useAuth';
import { useRole } from '@hooks/useRole';
import { useUserProfile } from '@pages/user-profile/useUserProfile';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@keystonehq/animated-qr', () => ({ AnimatedQRCode: () => null }));
vi.mock('@hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@hooks/useRole', () => ({ useRole: vi.fn() }));
vi.mock('@pages/user-profile/useUserProfile', () => ({ useUserProfile: vi.fn() }));

import { PAGES } from './pages';
import { signedInRoutes } from './signedInRoutes';

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

function Address() {
  return (
    <p data-testid="address" data-arrived-by={useNavigationType()}>
      {useLocation().pathname}
    </p>
  );
}

function open(role: AccountRole, signedIn = true, signupFinished = true) {
  vi.mocked(useAuth).mockReturnValue({ isAuthenticated: signedIn, isLoading: false, isFetching: false } as ReturnType<
    typeof useAuth
  >);
  vi.mocked(useRole).mockReturnValue({
    role,
    isKnown: true,
    isUnavailable: false,
    isLoading: false,
    retry: vi.fn(),
  } as unknown as ReturnType<typeof useRole>);
  vi.mocked(useUserProfile).mockReturnValue({
    userProfile: { isSignupCompleted: signupFinished },
    isLoading: false,
    refreshProfile: vi.fn(),
  } as unknown as ReturnType<typeof useUserProfile>);
  render(
    <QueryClientProvider client={client}>
      <InSignedInFrame.Provider value>
        <MemoryRouter initialEntries={['/dividends']}>
          <Address />
          <Routes>
            {signedInRoutes(PAGES)}
            <Route path="/signin" element={<p>Sign in first</p>} />
            <Route path="/signup/account-type" element={<p>Finish signing up</p>} />
          </Routes>
        </MemoryRouter>
      </InSignedInFrame.Provider>
    </QueryClientProvider>,
  );
}

it.each(['investor', 'company', 'both'] as const)(
  'replaces the legacy dividend address with personal Notices for %s',
  async (role) => {
    open(role);
    expect(await screen.findByText(PUBLICATION_COPY.EMPTY_TITLE)).toBeTruthy();
    expect(screen.getByTestId('address').textContent).toBe('/publications');
    expect(screen.getByTestId('address').dataset.arrivedBy).toBe('REPLACE');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Notices');
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/api/v1/publications/', { params: { page: 1, addressed: 'me' } });
  },
);

it.each([
  [false, true, '/signin', 'Sign in first'],
  [true, false, '/signup/account-type', 'Finish signing up'],
] as const)(
  'keeps the legacy alias guarded for signedIn=%s, signupFinished=%s',
  async (signedIn, signupFinished, path, text) => {
    open('investor', signedIn, signupFinished);
    expect(await screen.findByText(text)).toBeTruthy();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.getByTestId('address').textContent).toBe(path);
    expect(api.get).not.toHaveBeenCalled();
  },
);

// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountRole } from '@ledova/shared';

import Layout from '@components/Layout';
import { useAuth } from '@hooks/useAuth';
import { useRole } from '@hooks/useRole';
import { useUserProfile } from '@pages/user-profile/useUserProfile';
import NotFoundPage from './NotFound';

vi.mock('@hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@hooks/useRole', () => ({ useRole: vi.fn() }));
vi.mock('@pages/user-profile/useUserProfile', () => ({ useUserProfile: vi.fn() }));
vi.mock('@components/Sidebar', () => ({ Sidebar: () => <nav aria-label="Sidebar" /> }));
vi.mock('@components/MobileHeader', () => ({ MobileHeader: () => null }));
vi.mock('@components/Footer', () => ({ default: () => null }));
vi.mock('@hooks/useBuyCrypto', () => ({
  BuyCryptoProvider: ({ children }: PropsWithChildren) => children,
}));
vi.mock('@hooks/useSendTransfer', () => ({
  SendTransferProvider: ({ children }: PropsWithChildren) => children,
}));

function visit({
  signedIn,
  finished = true,
  role = 'investor',
  isLoading = false,
  profileLoading = false,
  address = '/no-such-page',
}: {
  signedIn: boolean;
  finished?: boolean;
  role?: AccountRole;
  isLoading?: boolean;
  profileLoading?: boolean;
  address?: string;
}) {
  vi.mocked(useAuth).mockReturnValue({ isAuthenticated: signedIn, isLoading } as ReturnType<typeof useAuth>);
  vi.mocked(useRole).mockReturnValue({ role, isLoading: false } as ReturnType<typeof useRole>);
  vi.mocked(useUserProfile).mockReturnValue({
    userProfile: signedIn && !profileLoading ? { isSignupCompleted: finished } : null,
    isLoading: profileLoading,
  } as ReturnType<typeof useUserProfile>);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[address]}>
        <Layout>
          <Routes>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Layout>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('an address that is not a page', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('shows a signed-out visitor the page without the signed-in frame, with a way to sign in', () => {
    visit({ signedIn: false });

    expect(screen.getByRole('heading', { name: 'There is no page at this address' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/signin');
    expect(screen.queryByRole('navigation', { name: 'Sidebar' })).toBeNull();
  });

  it.each([
    ['an investor', 'investor', 'Go to Home', '/home'],
    ['a company', 'company', 'Go to Company', '/company'],
    ['a dual-role account', 'both', 'Go to Company', '/company'],
  ] as const)('shows %s, signed in, the page inside the frame with a way to its landing', (_, role, label, landing) => {
    visit({ signedIn: true, role });

    expect(screen.getByRole('heading', { name: 'There is no page at this address' })).toBeTruthy();
    expect(screen.getByRole('link', { name: label }).getAttribute('href')).toBe(landing);
    expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBeTruthy();
  });

  it('shows an account that has not finished sign-up the page without the frame, with a way back into sign-up', () => {
    visit({ signedIn: true, finished: false });

    expect(screen.getByRole('heading', { level: 1, name: 'There is no page at this address' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Continue signing up' }).getAttribute('href')).toBe('/signup/account-type');
    expect(screen.queryByRole('navigation', { name: 'Sidebar' })).toBeNull();
  });

  it.each([
    ['a finished account', true, true],
    ['an account still signing up', false, false],
  ] as const)('shows %s the same frame and page at an unknown address under /signup', (_, finished, framed) => {
    visit({ signedIn: true, finished, address: '/signup/typo' });

    expect(screen.getByRole('heading', { level: 1, name: 'There is no page at this address' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Sidebar' }) !== null).toBe(framed);
  });

  it('says nothing to a signed-in account until its profile says whether sign-up is finished', () => {
    visit({ signedIn: true, profileLoading: true });

    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Continue signing up' })).toBeNull();
  });

  it('lets an account still signing up sign out, since the sidebar with Sign out is not shown to it', () => {
    visit({ signedIn: true, finished: false });

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('offers no sign-out to a signed-out visitor', () => {
    visit({ signedIn: false });

    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
  });

  it('says nothing until it knows whether the visitor is signed in', () => {
    visit({ signedIn: false, isLoading: true });

    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

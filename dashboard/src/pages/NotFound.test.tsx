// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountRole } from '@ledova/shared';

import Layout from '@components/Layout';
import { useAuth } from '@hooks/useAuth';
import { useRole } from '@hooks/useRole';
import NotFoundPage from './NotFound';

vi.mock('@hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@hooks/useRole', () => ({ useRole: vi.fn() }));
vi.mock('@components/Sidebar', () => ({ Sidebar: () => <nav aria-label="Sidebar" /> }));
vi.mock('@components/DesktopHeader', () => ({ DesktopHeader: () => null }));
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
  role = 'investor',
  isLoading = false,
}: {
  signedIn: boolean;
  role?: AccountRole;
  isLoading?: boolean;
}) {
  vi.mocked(useAuth).mockReturnValue({ isAuthenticated: signedIn, isLoading } as ReturnType<typeof useAuth>);
  vi.mocked(useRole).mockReturnValue({ role, isLoading: false } as ReturnType<typeof useRole>);
  render(
    <MemoryRouter initialEntries={['/no-such-page']}>
      <Layout>
        <Routes>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Layout>
    </MemoryRouter>,
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

  it('says nothing until it knows whether the visitor is signed in', () => {
    visit({ signedIn: false, isLoading: true });

    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

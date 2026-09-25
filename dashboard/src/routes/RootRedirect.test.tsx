// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuth, useRole } from '@hooks';
import { RootRedirect } from './RootRedirect';

vi.mock('@hooks', () => ({ useAuth: vi.fn(), useRole: vi.fn() }));

const useAuthMock = vi.mocked(useAuth);
const useRoleMock = vi.mocked(useRole);

function signedInAs(role: 'investor' | 'company' | 'both', isLoading = false) {
  useAuthMock.mockReturnValue({ isAuthenticated: true, isLoading: false } as ReturnType<typeof useAuth>);
  useRoleMock.mockReturnValue({ role, isLoading } as ReturnType<typeof useRole>);
}
const THE_APPLICATION = 'http://localhost:5174/';

function renderRoot() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/signin" element={<p>Sign in</p>} />
        <Route path="/home" element={<p>Home</p>} />
        <Route path="/company" element={<p>Company</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('where the front door sends a visitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRoleMock.mockReturnValue({ role: 'investor', isLoading: false } as ReturnType<typeof useRole>);
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: THE_APPLICATION },
    });
  });

  afterEach(cleanup);

  it('sends a signed-out visitor to sign in, like every other guarded route', () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: false } as ReturnType<typeof useAuth>);

    renderRoot();

    expect(screen.getByText('Sign in')).toBeTruthy();
  });

  it('does not leave the application, which is what stranded the visitor', () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: false } as ReturnType<typeof useAuth>);

    renderRoot();

    expect(window.location.href).toBe(THE_APPLICATION);
  });

  it('sends a signed-in investor to their home', () => {
    signedInAs('investor');

    renderRoot();

    expect(screen.getByText('Home')).toBeTruthy();
  });

  it.each(['company', 'both'] as const)('sends a signed-in %s account to its company', (role) => {
    signedInAs(role);

    renderRoot();

    expect(screen.getByText('Company')).toBeTruthy();
  });

  it('waits for the role before choosing, so a company is never shown the investor home first', () => {
    signedInAs('company', true);

    renderRoot();

    expect(screen.queryByText('Home')).toBeNull();
    expect(screen.queryByText('Company')).toBeNull();
  });

  it('decides nothing while it does not yet know', () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: true } as ReturnType<typeof useAuth>);

    renderRoot();

    expect(screen.queryByText('Sign in')).toBeNull();
    expect(screen.queryByText('Home')).toBeNull();
    expect(window.location.href).toBe(THE_APPLICATION);
  });
});

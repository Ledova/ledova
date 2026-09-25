// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountRole } from '@ledova/shared';

import { useAuth } from '@hooks/useAuth';
import { useRole } from '@hooks/useRole';
import { useUserProfile } from '@pages/user-profile/useUserProfile';
import { SignupRoute } from './SignupRoute';

vi.mock('@hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@hooks/useRole', () => ({ useRole: vi.fn() }));
vi.mock('@pages/user-profile/useUserProfile', () => ({ useUserProfile: vi.fn() }));

function Page({ name, next }: { name: string; next?: string }) {
  const navigate = useNavigate();
  return (
    <div>
      <p data-arrived-by={useNavigationType()}>{name}</p>
      {next && <button onClick={() => navigate(next)}>Continue</button>}
    </div>
  );
}

function open(
  address: string,
  { signedIn = true, finished = true, role = 'investor' as AccountRole, profileLoading = false } = {},
) {
  vi.mocked(useAuth).mockReturnValue({ isAuthenticated: signedIn, isLoading: false } as ReturnType<typeof useAuth>);
  vi.mocked(useRole).mockReturnValue({ role, isLoading: false } as ReturnType<typeof useRole>);
  vi.mocked(useUserProfile).mockReturnValue({
    userProfile: signedIn && !profileLoading ? { isSignupCompleted: finished } : null,
    isLoading: profileLoading,
  } as ReturnType<typeof useUserProfile>);
  render(
    <MemoryRouter initialEntries={[address]}>
      <Routes>
        <Route element={<SignupRoute />}>
          <Route path="/signup/email-confirmation" element={<Page name="email-confirmation" />} />
          <Route path="/signup/account-type" element={<Page name="account-type" next="/signup/pre-screening" />} />
          <Route path="/signup/pre-screening" element={<Page name="pre-screening" next="/signup/review" />} />
          <Route path="/signup/review" element={<Page name="review" />} />
        </Route>
        <Route path="/home" element={<Page name="home" />} />
        <Route path="/company" element={<Page name="company" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function sentTo(name: string) {
  return screen.getByText(name).dataset.arrivedBy === 'REPLACE';
}

describe('who can open the sign-up steps', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it.each([
    ['investor', 'home'],
    ['company', 'company'],
    ['both', 'company'],
  ] as const)('sends a finished %s account to its %s', (role, landing) => {
    open('/signup/account-type', { role });
    expect(sentTo(landing)).toBe(true);
    expect(screen.queryByText('account-type')).toBeNull();
  });

  it.each(['/signup/email-confirmation', '/signup/pre-screening', '/signup/review'])(
    'does not reopen %s for an account that has finished sign-up',
    (address) => {
      open(address);
      expect(sentTo('home')).toBe(true);
    },
  );

  it('lets an account that has not finished sign-up move through the steps', () => {
    open('/signup/account-type', { finished: false });
    expect(screen.getByText('account-type')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('pre-screening')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('review')).toBeTruthy();
    expect(screen.queryByText('home')).toBeNull();
  });

  it('lets a signed-out visitor confirm their email', () => {
    open('/signup/email-confirmation', { signedIn: false });
    expect(screen.getByText('email-confirmation')).toBeTruthy();
  });

  it('shows neither the step nor a landing until the profile is known', () => {
    open('/signup/account-type', { profileLoading: true });
    expect(screen.queryByText('account-type')).toBeNull();
    expect(screen.queryByText('home')).toBeNull();
  });
});

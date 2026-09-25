// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useNavigate, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountRole } from '@ledova/shared';

import { useAuth } from '@hooks/useAuth';
import { useRole } from '@hooks/useRole';
import { useUserProfile } from '@pages/user-profile/useUserProfile';
import { SIGNUP_STEPS, signupRoutes, type SignupStep } from './signupRoutes';

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

const STEPS = Object.fromEntries(
  SIGNUP_STEPS.map((path, index) => [path, <Page key={path} name={path} next={SIGNUP_STEPS[index + 1]} />]),
) as Record<SignupStep, ReactElement>;

const refreshProfile = vi.fn();

function open(
  address: string,
  {
    signedIn = true,
    finished = true,
    role = 'investor' as AccountRole,
    profileLoading = false,
    profileFailed = false,
  } = {},
) {
  vi.mocked(useAuth).mockReturnValue({ isAuthenticated: signedIn, isLoading: false } as ReturnType<typeof useAuth>);
  vi.mocked(useRole).mockReturnValue({ role, isLoading: false } as ReturnType<typeof useRole>);
  vi.mocked(useUserProfile).mockReturnValue({
    userProfile: signedIn && !profileLoading && !profileFailed ? { isSignupCompleted: finished } : null,
    isLoading: profileLoading,
    isError: profileFailed,
    refreshProfile,
  } as unknown as ReturnType<typeof useUserProfile>);
  render(
    <MemoryRouter initialEntries={[address]}>
      <Routes>
        {signupRoutes(STEPS)}
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
    expect(screen.queryByText('/signup/account-type')).toBeNull();
  });

  it.each(SIGNUP_STEPS)('does not reopen %s for an account that has finished sign-up', (address) => {
    open(address);
    expect(sentTo('home')).toBe(true);
    expect(screen.queryByText(address)).toBeNull();
  });

  it('lets an account that has not finished sign-up move through every step', () => {
    open(SIGNUP_STEPS[0], { finished: false });

    for (const step of SIGNUP_STEPS.slice(1)) {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      expect(screen.getByText(step)).toBeTruthy();
    }
    expect(screen.queryByText('home')).toBeNull();
  });

  it('lets a signed-out visitor confirm their email', () => {
    open('/signup/email-confirmation', { signedIn: false });
    expect(screen.getByText('/signup/email-confirmation')).toBeTruthy();
  });

  it('shows neither the step nor a landing until the profile is known', () => {
    open('/signup/account-type', { profileLoading: true });
    expect(screen.queryByText('/signup/account-type')).toBeNull();
    expect(screen.queryByText('home')).toBeNull();
  });

  it('shows a signed-in account whose profile could not be read an error, not a step', () => {
    open('/signup/account-type', { profileFailed: true });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('/signup/account-type')).toBeNull();
    expect(screen.queryByText('home')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refreshProfile).toHaveBeenCalledOnce();
  });
});

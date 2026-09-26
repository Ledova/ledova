// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESTINATIONS, type AccountRole, type DestinationKey } from '@ledova/shared';

import { useAuth } from '@hooks/useAuth';
import { useRole } from '@hooks/useRole';
import { signedInRoutes } from './signedInRoutes';

vi.mock('@hooks/useAuth', () => ({ useAuth: vi.fn() }));
vi.mock('@hooks/useRole', () => ({ useRole: vi.fn() }));

const useAuthMock = vi.mocked(useAuth);
const useRoleMock = vi.mocked(useRole);

function Page({ name }: { name: string }) {
  return <p data-arrived-by={useNavigationType()}>{name}</p>;
}

const KEYS = Object.keys(DESTINATIONS) as DestinationKey[];
const PAGES = Object.fromEntries(KEYS.map((key) => [key, <Page key={key} name={key} />])) as Record<
  DestinationKey,
  ReactElement
>;

function addressOf(key: DestinationKey) {
  return DESTINATIONS[key].path.replace(':uuid', '7f1c2a9e');
}

const retry = vi.fn();

function open(
  key: DestinationKey,
  role: AccountRole,
  { roleLoading = false, roleUnavailable = false, signedIn = true } = {},
) {
  useAuthMock.mockReturnValue({ isAuthenticated: signedIn, isLoading: false, isFetching: false } as ReturnType<
    typeof useAuth
  >);
  useRoleMock.mockReturnValue({
    role,
    isLoading: roleLoading,
    isKnown: signedIn && !roleLoading && !roleUnavailable,
    isUnavailable: roleUnavailable,
    retry,
  } as unknown as ReturnType<typeof useRole>);
  render(
    <MemoryRouter initialEntries={[addressOf(key)]}>
      <Routes>
        {signedInRoutes(PAGES)}
        <Route path="/signin" element={<Page name="signin" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function opened(name: string) {
  return screen.getByText(name).dataset.arrivedBy === 'POP';
}

function sentTo(name: string) {
  return screen.getByText(name).dataset.arrivedBy === 'REPLACE';
}

describe('which signed-in pages an account can open', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it.each(['home', 'publications'] as const)('lets an investor open %s, a page for everyone', (key) => {
    open(key, 'investor');
    expect(opened(key)).toBe(true);
  });

  it.each(['directoryDetail', 'trading'] as const)('lets an investor open %s, an investing page', (key) => {
    open(key, 'investor');
    expect(opened(key)).toBe(true);
  });

  it.each(['company', 'companyListing'] as const)('sends an investor opening %s to their home instead', (key) => {
    open(key, 'investor');
    expect(sentTo('home')).toBe(true);
    expect(screen.queryByText(key)).toBeNull();
  });

  it.each(['wallets', 'transactions'] as const)('lets a company open %s, a page for everyone', (key) => {
    open(key, 'company');
    expect(opened(key)).toBe(true);
  });

  it.each(['companyListing', 'companyOffering'] as const)('lets a company open %s, a company page', (key) => {
    open(key, 'company');
    expect(opened(key)).toBe(true);
  });

  it.each(['trading', 'directory', 'subscriptionDetail'] as const)(
    'sends a company opening %s to its company instead',
    (key) => {
      open(key, 'company');
      expect(sentTo('company')).toBe(true);
      expect(screen.queryByText(key)).toBeNull();
    },
  );

  it.each(KEYS)('lets a dual-role account open %s', (key) => {
    open(key, 'both');
    expect(opened(key)).toBe(true);
  });

  it.each(['trading', 'company'] as const)(
    'shows the session check on %s until the role is known, and neither the page nor a landing',
    (key) => {
      open(key, 'investor', { roleLoading: true });
      expect(screen.getByRole('status', { name: 'Checking your session' })).toBeTruthy();
      expect(screen.queryByText(key)).toBeNull();
      expect(screen.queryByText('home')).toBeNull();
      expect(screen.queryByText('company')).toBeNull();
    },
  );

  it.each([
    ['company', 'company'],
    ['trading', 'investor'],
  ] as const)('says the account could not be checked on %s rather than deciding with a guessed role', (key, role) => {
    open(key, role, { roleUnavailable: true });
    expect(screen.getByRole('alert').textContent).toContain('Your account could not be checked');
    expect(screen.queryByText(key)).toBeNull();
    expect(screen.queryByText('home')).toBeNull();
    expect(screen.queryByText('company')).toBeNull();
  });

  it('checks the account again from Try again', () => {
    open('company', 'company', { roleUnavailable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('opens a page for everyone even when the account could not be checked', () => {
    open('wallets', 'company', { roleUnavailable: true });
    expect(opened('wallets')).toBe(true);
  });

  it('does not hold a page for everyone while the role loads', () => {
    open('wallets', 'investor', { roleLoading: true });
    expect(opened('wallets')).toBe(true);
  });

  it('still sends a signed-out visitor to sign in', () => {
    open('company', 'investor', { signedIn: false });
    expect(sentTo('signin')).toBe(true);
  });
});

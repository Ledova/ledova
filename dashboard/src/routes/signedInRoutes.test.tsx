// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InSignedInFrame } from '@components/InSignedInFrame';
import { DESTINATIONS, useAuth, type AccountRole, type DestinationKey } from '@ledova/shared';

import { useRole } from '@hooks/useRole';
import { useUserProfile } from '@pages/user-profile/useUserProfile';
import { signedInRoutes } from './signedInRoutes';

vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  useAuth: vi.fn(),
}));
vi.mock('@hooks/useRole', () => ({ useRole: vi.fn() }));
vi.mock('@pages/user-profile/useUserProfile', () => ({ useUserProfile: vi.fn() }));

const useAuthMock = vi.mocked(useAuth);
const useRoleMock = vi.mocked(useRole);
const useUserProfileMock = vi.mocked(useUserProfile);

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
  {
    roleLoading = false,
    roleUnavailable = false,
    signedIn = true,
    signupFinished = true,
    profileLoading = false,
    profileFailed = false,
    frameShowing = true,
  } = {},
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
  useUserProfileMock.mockReturnValue({
    userProfile: profileLoading || profileFailed ? null : { isSignupCompleted: signupFinished },
    isLoading: profileLoading,
    isError: profileFailed,
    refreshProfile: vi.fn(),
  } as unknown as ReturnType<typeof useUserProfile>);
  render(
    <InSignedInFrame.Provider value={signedIn && signupFinished && !profileLoading && !profileFailed && frameShowing}>
      <MemoryRouter initialEntries={[addressOf(key)]}>
        <Address />
        <Routes>
          {signedInRoutes(PAGES)}
          <Route path="/signin" element={<Page name="signin" />} />
          <Route path="/signup/account-type" element={<Page name="signup" />} />
        </Routes>
      </MemoryRouter>
    </InSignedInFrame.Provider>,
  );
}

function Address() {
  return <p data-testid="address">{useLocation().pathname}</p>;
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

  it.each([
    'home',
    'publications',
    'company',
    'companyRegister',
    'companyRegisterImport',
    'companyRegisterCorrection',
    'companyRegisterOpening',
    'companyRegisterParticulars',
    'companyTeam',
    'companyListing',
    'companyEligibility',
  ] as const)('lets an investor open %s, a page for everyone', (key) => {
    open(key, 'investor');
    expect(opened(key)).toBe(true);
  });

  it.each(['directoryDetail', 'trading', 'eligibilityRequests'] as const)(
    'lets an investor open %s, an investing page',
    (key) => {
      open(key, 'investor');
      expect(opened(key)).toBe(true);
    },
  );

  it('sends an investor opening a company page to their home at once, even before the frame is showing', () => {
    open('companyClass', 'investor', { frameShowing: false });

    expect(screen.getByTestId('address').textContent).toBe(DESTINATIONS.home.path);
    expect(screen.queryByText('company')).toBeNull();
  });

  it.each(['companyClass', 'companyOffering', 'companyPublications'] as const)(
    'sends an investor opening %s to their home instead',
    (key) => {
      open(key, 'investor');
      expect(sentTo('home')).toBe(true);
      expect(screen.queryByText(key)).toBeNull();
    },
  );

  it.each([
    'wallets',
    'transactions',
    'companyRegister',
    'companyRegisterImport',
    'companyRegisterCorrection',
    'companyRegisterOpening',
    'companyRegisterParticulars',
  ] as const)('lets a company open %s, a page for everyone', (key) => {
    open(key, 'company');
    expect(opened(key)).toBe(true);
  });

  it.each(['companyClass', 'companyAuthority', 'companyOffering', 'companyPublications'] as const)(
    'lets a company open %s, a company page',
    (key) => {
      open(key, 'company');
      expect(opened(key)).toBe(true);
    },
  );

  it.each(['trading', 'directory', 'subscriptionDetail'] as const)(
    'sends a company opening %s to Register instead',
    (key) => {
      open(key, 'company');
      expect(sentTo('companyRegister')).toBe(true);
      expect(screen.queryByText(key)).toBeNull();
    },
  );

  it.each(KEYS)('lets a dual-role account open %s', (key) => {
    open(key, 'both');
    expect(opened(key)).toBe(true);
  });

  it.each(['wallets', 'trading', 'company', 'companyRegister', 'companyClass'] as const)(
    'gives a role the API does not define only the pages for everyone, sending it from %s to its home',
    (key) => {
      open(key, 'staff' as AccountRole);
      expect(DESTINATIONS[key].audience === 'everyone' ? opened(key) : sentTo('home')).toBe(true);
      expect(screen.getByTestId('address').textContent).toBe(
        addressOf(DESTINATIONS[key].audience === 'everyone' ? key : 'home'),
      );
    },
  );

  it.each(['trading', 'companyClass'] as const)(
    'keeps %s titled and loading until the role is known, and shows neither the page nor a landing',
    (key) => {
      open(key, 'investor', { roleLoading: true });
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DESTINATIONS[key].title);
      expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
      expect(screen.queryByText(key)).toBeNull();
      expect(screen.queryByText('home')).toBeNull();
      expect(screen.queryByText('company')).toBeNull();
    },
  );

  it.each([
    ['companyClass', 'company'],
    ['trading', 'investor'],
  ] as const)('says the account could not be checked on %s rather than deciding with a guessed role', (key, role) => {
    open(key, role, { roleUnavailable: true });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DESTINATIONS[key].title);
    expect(screen.getByRole('alert').textContent).toContain('Your account could not be checked');
    expect(screen.queryByText(key)).toBeNull();
    expect(screen.queryByText('home')).toBeNull();
    expect(screen.queryByText('company')).toBeNull();
  });

  it('checks the account again from Try again', () => {
    open('companyClass', 'company', { roleUnavailable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each(['wallets', 'companyRegister'] as const)(
    'opens %s, a page for everyone, even when the account could not be checked',
    (key) => {
      open(key, 'company', { roleUnavailable: true });
      expect(opened(key)).toBe(true);
    },
  );

  it.each(['wallets', 'companyRegister'] as const)(
    'does not hold %s, a page for everyone, while the role loads',
    (key) => {
      open(key, 'investor', { roleLoading: true });
      expect(opened(key)).toBe(true);
    },
  );

  it('opens the import page of a share class at its own address, not the class page beneath it', () => {
    open('companyRegisterImport', 'investor');
    expect(DESTINATIONS.companyRegisterImport.path).toBe('/company/register/:uuid/import');
    expect(screen.getByTestId('address').textContent).toBe('/company/register/7f1c2a9e/import');
    expect(opened('companyRegisterImport')).toBe(true);
    expect(screen.queryByText('companyClass')).toBeNull();
  });

  it('opens the correction page of a register entry at its own address beneath its share class', () => {
    open('companyRegisterCorrection', 'investor');
    expect(DESTINATIONS.companyRegisterCorrection.path).toBe('/company/register/:uuid/correct/:entry');
    expect(screen.getByTestId('address').textContent).toBe('/company/register/7f1c2a9e/correct/:entry');
    expect(opened('companyRegisterCorrection')).toBe(true);
    expect(screen.queryByText('companyClass')).toBeNull();
  });

  it('opens the opening page of a share class at its own address, not the class page beneath it', () => {
    open('companyRegisterOpening', 'investor');
    expect(DESTINATIONS.companyRegisterOpening.path).toBe('/company/register/:uuid/open');
    expect(screen.getByTestId('address').textContent).toBe('/company/register/7f1c2a9e/open');
    expect(opened('companyRegisterOpening')).toBe(true);
    expect(screen.queryByText('companyClass')).toBeNull();
  });

  it('opens the particulars page of a member at its own address beneath Register, not a class page', () => {
    open('companyRegisterParticulars', 'investor');
    expect(screen.getByTestId('address').textContent).toBe('/company/register/members/:member/particulars');
    expect(opened('companyRegisterParticulars')).toBe(true);
    expect(screen.queryByText('companyClass')).toBeNull();
  });

  it('still sends a signed-out visitor to sign in', () => {
    open('company', 'investor', { signedIn: false });
    expect(sentTo('signin')).toBe(true);
  });

  it.each(KEYS)('sends an account that has not finished sign-up from %s back into sign-up', (key) => {
    open(key, 'both', { signupFinished: false });
    expect(sentTo('signup')).toBe(true);
    expect(screen.queryByText(key)).toBeNull();
  });

  it('shows an account whose profile could not be read an error, and does not send it into sign-up', () => {
    open('home', 'investor', { profileFailed: true });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.queryByText('home')).toBeNull();
    expect(screen.queryByText('signup')).toBeNull();
  });

  it('shows the session check on a page for everyone until the profile says whether sign-up is finished', () => {
    open('wallets', 'investor', { profileLoading: true });
    expect(screen.getByRole('status', { name: 'Checking your session' })).toBeTruthy();
    expect(screen.queryByText('wallets')).toBeNull();
    expect(screen.queryByText('signup')).toBeNull();
  });
});

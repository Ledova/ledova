// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { DESTINATIONS, type DestinationKey } from '@ledova/shared';

import { InSignedInFrame } from '@components/InSignedInFrame';
import { Page } from '@components/Page';
import { signedInRoutes } from './signedInRoutes';

vi.mock('@hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false, isFetching: false }) }));
vi.mock('@hooks/useRole', () => ({
  useRole: () => ({ role: 'both', isKnown: true, isUnavailable: false, retry: vi.fn() }),
}));
vi.mock('@pages/user-profile/useUserProfile', () => ({
  useUserProfile: () => ({ userProfile: { isSignupCompleted: true }, isLoading: false }),
}));

const KEYS = Object.keys(DESTINATIONS) as DestinationKey[];
const PAGES = Object.fromEntries(KEYS.map((key) => [key, <Page key={key}>{key}</Page>])) as Record<
  DestinationKey,
  ReactElement
>;

afterEach(cleanup);

it.each(KEYS)('titles the %s page with its own entry in the table of pages', (key) => {
  render(
    <InSignedInFrame.Provider value>
      <MemoryRouter initialEntries={[DESTINATIONS[key].path.replace(':uuid', '7f1c2a9e')]}>
        <Routes>{signedInRoutes(PAGES)}</Routes>
      </MemoryRouter>
    </InSignedInFrame.Provider>,
  );

  expect(screen.getByText(key)).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DESTINATIONS[key].title);
});

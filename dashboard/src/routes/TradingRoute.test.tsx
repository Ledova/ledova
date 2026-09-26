// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { DESTINATIONS } from '@ledova/shared';

import { useFeatureFlags } from '@hooks/useFeatureFlags';
import { PageTitle } from '@components/PageTitle';
import { TradingRoute } from './TradingRoute';

vi.mock('@hooks/useFeatureFlags', () => ({ useFeatureFlags: vi.fn() }));
vi.mock('@hooks/useRole', () => ({ useRole: () => ({ role: 'investor' }) }));
vi.mock('@pages/trading', () => ({ default: () => <p>The market</p> }));

function openTrading(flags: { tradingEnabled: boolean; isLoading: boolean }) {
  vi.mocked(useFeatureFlags).mockReturnValue(flags as ReturnType<typeof useFeatureFlags>);
  render(
    <MemoryRouter initialEntries={[DESTINATIONS.trading.path]}>
      <Routes>
        <Route
          path={DESTINATIONS.trading.path}
          element={
            <PageTitle.Provider value={DESTINATIONS.trading.title}>
              <TradingRoute />
            </PageTitle.Provider>
          }
        />
        <Route path={DESTINATIONS.home.path} element={<p>Home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

it('keeps the page title while the flags load', () => {
  openTrading({ tradingEnabled: false, isLoading: true });

  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(DESTINATIONS.trading.title);
  expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
});

it('opens the market once trading is on', () => {
  openTrading({ tradingEnabled: true, isLoading: false });

  expect(screen.getByText('The market')).toBeTruthy();
});

it('sends the account to its landing page while trading is off', () => {
  openTrading({ tradingEnabled: false, isLoading: false });

  expect(screen.getByText('Home')).toBeTruthy();
});

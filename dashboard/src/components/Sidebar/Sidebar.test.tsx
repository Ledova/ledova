// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canOpen, DESTINATIONS, landingFor, type AccountRole } from '@ledova/shared';

import { Sidebar } from '.';

const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('@services/apiClient', () => ({ default: {} }));
vi.mock('@hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('@hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ tradingEnabled: true, isLoading: false }) }));
vi.mock('@pages/user-profile/useUserProfile', () => ({ useUserProfile: () => ({ userProfile: null }) }));
vi.mock('@components/NotificationBell', () => ({
  NotificationBell: ({ align }: { align: string }) => <span data-testid="bell" data-align={align} />,
}));

function offeredTo(role: AccountRole) {
  const client = new QueryClient();
  client.setQueryData(['userAccount'], { data: { role } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  screen
    .getAllByRole('button')
    .filter((button) => button.textContent !== 'Sign out')
    .forEach((button) => fireEvent.click(button));
  return navigate.mock.calls.map(([path]) => path as string);
}

describe('the pages the sidebar offers', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it.each(['investor', 'company', 'both'] as const)('offers the %s role its landing page', (role) => {
    expect(offeredTo(role)).toContain(landingFor(role));
  });

  it.each(['investor', 'company', 'both'] as const)('offers the %s role no page it cannot open', (role) => {
    const refused = offeredTo(role).filter((path) => {
      const destination = Object.values(DESTINATIONS).find((candidate) => candidate.path === path);
      return !destination || !canOpen(role, destination.audience);
    });
    expect(refused).toEqual([]);
  });

  it.each([
    ['investor', true],
    ['company', false],
    ['both', true],
  ] as const)('offers Trading to the %s role: %s', (role, offered) => {
    expect(offeredTo(role).includes(DESTINATIONS.trading.path)).toBe(offered);
  });

  it.each(['investor', 'company', 'both'] as const)('offers the %s role no Buy or Send', (role) => {
    offeredTo(role);
    expect(screen.queryAllByRole('button', { name: /buy|send/i }).map((button) => button.textContent)).toEqual([]);
  });
});

describe('where the sidebar puts the bell', () => {
  afterEach(cleanup);

  function shown(withNotifications: boolean) {
    const client = new QueryClient();
    client.setQueryData(['userAccount'], { data: { role: 'investor' } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Sidebar withNotifications={withNotifications} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('puts the bell beside the logo, opening towards the page', () => {
    shown(true);

    const logoRow = screen.getByText('Ledova').closest('aside')!.firstElementChild!;
    expect(logoRow.contains(screen.getByTestId('bell'))).toBe(true);
    expect(screen.getByTestId('bell').dataset.align).toBe('start');
  });

  it('leaves the bell out of the sidebar the phone menu opens', () => {
    shown(false);

    expect(screen.queryByTestId('bell')).toBeNull();
  });
});

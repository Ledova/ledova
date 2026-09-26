// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canOpen, COMPANY_ENDPOINTS, DESTINATIONS, landingFor, type AccountRole } from '@ledova/shared';

import { Sidebar } from '.';

const navigate = vi.hoisted(() => vi.fn());
const flags = vi.hoisted(() => ({ tradingEnabled: true }));
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('@hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ tradingEnabled: flags.tradingEnabled, isLoading: false }),
}));
vi.mock('@pages/user-profile/useUserProfile', () => ({ useUserProfile: () => ({ userProfile: null }) }));
vi.mock('@components/NotificationBell', () => ({
  NotificationBell: ({ align }: { align: string }) => <span data-testid="bell" data-align={align} />,
}));

function show(role: AccountRole, address = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['userAccount'], { data: { role } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[address]}>
        <Sidebar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

function offeredTo(role: AccountRole) {
  show(role);
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
  ] as const)('offers Market to the %s role: %s', (role, offered) => {
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

function menu() {
  return [...screen.getByRole('navigation').children].map((group) => ({
    label: group.querySelector('p')?.textContent ?? null,
    items: [...group.querySelectorAll('button, a')].map((item) => item.textContent),
  }));
}

const YOUR_SHARES = { label: 'Your shares', items: ['Holdings', 'Notices', 'Activity'] };
const INVEST = { label: 'Invest', items: ['Directory', 'Applications', 'Market', 'Verification'] };
const YOURS = { label: null, items: ['Wallets', 'Profile', 'Settings', 'Help & Support'] };
const COMPANY = { label: 'Harbour Robotics Pty Ltd', items: ['Offerings', 'Company'] };

describe('the groups the sidebar shows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.tradingEnabled = true;
    api.get.mockResolvedValue({
      data: { results: [{ uuid: 'company', name: 'Harbour Robotics Pty Ltd' }], count: 1, next: null, previous: null },
    });
  });
  afterEach(cleanup);

  it("gives an investor Your shares, then Invest, then the account's own pages", () => {
    show('investor');

    expect(menu()).toEqual([YOUR_SHARES, INVEST, YOURS]);
  });

  it("puts a company's own group first, named after the company, and still gives it Your shares", async () => {
    show('company');

    expect(await screen.findByText(COMPANY.label)).toBeTruthy();
    expect(menu()).toEqual([COMPANY, YOUR_SHARES, YOURS]);
  });

  it('gives an account with both roles the company group, Your shares and Invest', async () => {
    show('both');

    expect(await screen.findByText(COMPANY.label)).toBeTruthy();
    expect(menu()).toEqual([COMPANY, YOUR_SHARES, INVEST, YOURS]);
  });

  it('leaves Market out of Invest while trading is off', () => {
    flags.tradingEnabled = false;
    show('investor');

    expect(menu()[1]).toEqual({ label: 'Invest', items: ['Directory', 'Applications', 'Verification'] });
  });

  it("names the company group Company while the company's name is still unknown", () => {
    api.get.mockReturnValue(new Promise(() => {}));
    show('company');

    expect(menu()[0]).toEqual({ label: 'Company', items: COMPANY.items });
  });

  it.each([
    ['no company', []],
    ['a company with a blank name', [{ uuid: 'company', name: '' }]],
  ])('names the company group Company when the list holds %s', async (_, results) => {
    api.get.mockResolvedValue({ data: { results, count: results.length, next: null, previous: null } });
    const client = show('company');

    await waitFor(() => expect(client.getQueryState(['companies'])?.status).toBe('success'));

    expect(menu()[0].label).toBe('Company');
  });

  it('asks for the company only for an account with a company role', async () => {
    show('investor');
    show('company');

    expect(await screen.findByText(COMPANY.label)).toBeTruthy();
    expect(api.get.mock.calls.filter(([url]) => url === COMPANY_ENDPOINTS.BASE)).toHaveLength(1);
  });

  it("marks the current page's item, and only that one", () => {
    show('investor', DESTINATIONS.directory.path);

    expect(screen.getAllByRole('button', { current: 'page' }).map((item) => item.textContent)).toEqual(['Directory']);
  });
});

describe('the page the sidebar marks as current', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: { results: [], count: 0, next: null, previous: null } });
  });
  afterEach(cleanup);

  const current = () =>
    screen
      .queryAllByRole('button')
      .filter((button) => button.getAttribute('aria-current') === 'page')
      .map((button) => button.textContent);

  it('marks Applications while one application is open', () => {
    show('investor', '/subscriptions/7f1c2a9e');
    expect(current()).toEqual(['Applications']);
  });

  it('marks only Application on the company application page, not Company as well', () => {
    show('company', '/company/listing');
    expect(current()).toEqual(['Application']);
  });
});

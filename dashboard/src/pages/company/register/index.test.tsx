// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { COMPANY_TOKEN_ENDPOINTS, type TokenHoldersResponse } from '@ledova/shared';
import { MemoryRouter } from 'react-router-dom';
import { PageTitle } from '@components/PageTitle';
import CompanyRegisterPage from '.';

const api = vi.hoisted(() => ({ get: vi.fn() }));
const role = vi.hoisted(() => ({ isKnown: true, isCompany: true }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@hooks/useRole', () => ({ useRole: () => role }));
let client: QueryClient;

function register(uuid = 'ordinary', overrides: Partial<TokenHoldersResponse> = {}): TokenHoldersResponse {
  return {
    token: {
      uuid,
      name: uuid === 'ordinary' ? 'Ordinary shares' : 'Preference shares',
      symbol: uuid.toUpperCase(),
      status: 'deployed',
      totalSupply: '9007199254740999',
    },
    initialized: true,
    issuedSupply: '9007199254740993',
    waitingEffects: 0,
    holders: [
      {
        member: 'member-one',
        name: 'Example Member',
        holderType: 'member',
        balance: '9007199254740993',
        shareClass: 'Ordinary shares',
        source: 'register',
        identitySource: 'stamp',
        enteredOn: '2026-09-01',
        percentage: 100,
        wallets: [{ address: `0x${'1'.repeat(40)}`, whitelistStatus: 'Active' }],
      },
    ],
    totalHolders: 1,
    formerMembers: [],
    formerMembersAsAt: null,
    formerMembersBlock: null,
    formerMembersStale: false,
    ...overrides,
  };
}

function page(uuids = ['ordinary'], next: string | null = null) {
  return {
    data: {
      results: uuids.map((uuid) => ({ uuid, companyName: 'Harbour Example Pty Ltd' })),
      count: uuids.length,
      next,
      previous: null,
    },
  };
}

function show() {
  return render(
    <QueryClientProvider client={client}>
      <PageTitle.Provider value="Register">
        <MemoryRouter>
          <CompanyRegisterPage />
        </MemoryRouter>
      </PageTitle.Provider>
    </QueryClientProvider>,
  );
}

function serve(value = register()) {
  api.get.mockImplementation(async (url: string) => (url === COMPANY_TOKEN_ENDPOINTS.BASE ? page() : { data: value }));
}

beforeEach(() => {
  api.get.mockReset();
  role.isKnown = true;
  role.isCompany = true;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
});

it('keeps its title and a loading state until the class list resolves', async () => {
  let finish!: (response: ReturnType<typeof page>) => void;
  api.get.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  show();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Register');
  expect(screen.getByRole('status').textContent).toBe('Loading your register…');
  expect(screen.queryByText('Your company has no share classes yet.')).toBeNull();
  await act(async () => finish(page([])));
  expect(await screen.findByText('Your company has no share classes yet.')).toBeTruthy();
});

it('reads every class page and renders exact stored shares with each member and linked wallet', async () => {
  api.get.mockImplementation(async (url: string, config?: { params?: { page: number } }) => {
    if (url === COMPANY_TOKEN_ENDPOINTS.BASE)
      return config?.params?.page === 2
        ? page(['preference'])
        : page(['ordinary'], 'https://example.test/tokens/?page=2');
    return { data: register(url.includes('preference') ? 'preference' : 'ordinary') };
  });
  show();
  expect(await screen.findByText('Preference shares')).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith(COMPANY_TOKEN_ENDPOINTS.BASE, { params: { page: 2 } });
  const summary = screen.getByText('Ordinary shares').closest('summary')!;
  fireEvent.click(summary);
  expect(summary.closest('details')!.open).toBe(true);
  expect(screen.getAllByRole('link', { name: 'Open share class' })[0].getAttribute('href')).toBe(
    '/company/register/ordinary',
  );
  expect(screen.getAllByText('9,007,199,254,740,993 shares')).toHaveLength(2);
  expect(screen.getAllByText('9,007,199,254,740,999')).toHaveLength(2);
  expect(screen.getAllByText('Example Member')).toHaveLength(2);
  expect(screen.getAllByText(`0x${'1'.repeat(40)} · Active`)).toHaveLength(2);
  expect(screen.queryByText(/AUD|USD/)).toBeNull();
  expect(api.get.mock.calls.every(([url]) => String(url).startsWith(COMPANY_TOKEN_ENDPOINTS.BASE))).toBe(true);
});

it.each(['class list', 'class page two', 'register'])(
  'hides partial data when the %s fails and retries the complete read',
  async (failure) => {
    let failed = true;
    api.get.mockImplementation(async (url: string, config?: { params?: { page: number } }) => {
      if (url === COMPANY_TOKEN_ENDPOINTS.BASE) {
        if (config?.params?.page === 2) {
          if (failed && failure === 'class page two') throw new Error('Unavailable');
          return page(['preference']);
        }
        if (failed && failure === 'class list') throw new Error('Unavailable');
        return page(['ordinary'], 'https://example.test/tokens/?page=2');
      }
      if (failed && failure === 'register' && url.includes('preference')) throw new Error('Unavailable');
      return { data: register(url.includes('preference') ? 'preference' : 'ordinary') };
    });
    show();
    expect((await screen.findByRole('alert')).textContent).toContain("We couldn't load the complete register.");
    expect(screen.queryByText('Ordinary shares')).toBeNull();
    expect(screen.queryByText('Your company has no share classes yet.')).toBeNull();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Ordinary shares')).toBeTruthy();
    expect(screen.getByText('Preference shares')).toBeTruthy();
  },
);

it('hides stale members after a failed refresh and reflects a successful register invalidation', async () => {
  serve();
  show();
  expect(await screen.findByText('Example Member')).toBeTruthy();
  api.get.mockRejectedValue(new Error('Unavailable'));
  await act(async () => client.invalidateQueries({ queryKey: ['tokens'] }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Example Member')).toBeNull();
  serve(register('ordinary', { holders: [], totalHolders: 0, issuedSupply: '0' }));
  await act(async () => client.invalidateQueries({ queryKey: ['tokens'] }));
  expect(await screen.findByText('No current members are recorded for this class.')).toBeTruthy();
  expect(screen.queryByText('Example Member')).toBeNull();
});

it.each([null, 2])('keeps waiting effects %s distinct from a current register', async (waitingEffects) => {
  serve(register('ordinary', { waitingEffects }));
  show();
  await screen.findByText('Ordinary shares');
  expect(screen.getByRole('status').textContent).toContain(
    waitingEffects === null ? 'could not be checked' : '2 completed issues or transfers wait',
  );
  expect(screen.getByText('Example Member')).toBeTruthy();
});

it('does not present an unopened register as an empty opened register or zero issued shares', async () => {
  serve(
    register('ordinary', {
      initialized: false,
      issuedSupply: null,
      holders: [],
      totalHolders: 0,
      waitingEffects: null,
    }),
  );
  show();
  expect(await screen.findByText('Not opened')).toBeTruthy();
  expect(screen.getByText('Not recorded')).toBeTruthy();
  expect(screen.queryByText(/Current members/)).toBeNull();
  expect(screen.getByText(/An approved register opening starts it/)).toBeTruthy();
});

it('retains unresolved identity and wallet-less members without inventing a name', async () => {
  const holder = register().holders[0];
  serve(register('ordinary', { holders: [{ ...holder, name: null, holderType: 'ambiguous', wallets: [] }] }));
  show();
  expect(await screen.findByText('Ambiguous')).toBeTruthy();
  expect(screen.getByText(/wallets point to more than one person/)).toBeTruthy();
  expect(screen.getByText('No linked wallet')).toBeTruthy();
});

it.each(['1', '0', '-1', '1.5'])('rejects non-advancing pagination to page %s', async (next) => {
  api.get.mockResolvedValue(page(['ordinary'], `https://example.test/tokens/?page=${next}`));
  show();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(api.get).toHaveBeenCalledTimes(1);
});

it.each(['1.5', '-1', '1e3'])('rejects inexact share balance %s instead of publishing it', async (balance) => {
  serve(register('ordinary', { holders: [{ ...register().holders[0], balance }] }));
  show();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Example Member')).toBeNull();
});

it.each([
  [false, false],
  [false, true],
  [true, false],
])('does not read issuer records when known=%s company=%s', async (isKnown, isCompany) => {
  role.isKnown = isKnown;
  role.isCompany = isCompany;
  show();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(api.get).not.toHaveBeenCalled();
});

// @vitest-environment jsdom

import {
  COMPANY_TOKEN_ENDPOINTS,
  REGISTER_COPY,
  USER_PREFERENCES_QUERY_KEY,
  type AccountRole,
  type TokenHoldersResponse,
} from '@ledova/shared';
import SettingsPage from '@pages/settings';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CompanyRegisterPage from '.';
import { companyPreferences, prepareCompanyClient, renderCompanyPage } from '../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const REGISTER = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const IMPORTS = COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORTS;
const GRANTS = COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANTS;
const TRANSFERS = COMPANY_TOKEN_ENDPOINTS.REGISTER_TRANSFERS;
const OPENINGS = COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENINGS;
const CORRECTIONS = COMPANY_TOKEN_ENDPOINTS.REGISTER_CORRECTIONS;
const RECONCILIATIONS = COMPANY_TOKEN_ENDPOINTS.REGISTER_RECONCILIATIONS;
const PARTICULARS = COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGES;
const LINKS = COMPANY_TOKEN_ENDPOINTS.REGISTER_LINKS;
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const NO_REGISTER = REGISTER_COPY.NO_REGISTER;
let client: QueryClient;

interface Listed {
  uuid: string;
  companyUuid: string;
  companyName: string;
}

const harbour = (uuid: string): Listed => ({ uuid, companyUuid: 'harbour', companyName: 'Harbour Example Pty Ltd' });
const inland = (uuid: string): Listed => ({ uuid, companyUuid: 'inland', companyName: 'Inland Example Pty Ltd' });

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

function page(classes: Listed[] = [harbour('ordinary')], next: string | null = null) {
  return { data: { results: classes, count: classes.length, next, previous: null } };
}

function noCommands(url: string) {
  return [
    OPENINGS,
    IMPORTS,
    GRANTS,
    TRANSFERS,
    CORRECTIONS,
    RECONCILIATIONS,
    PARTICULARS,
    LINKS,
    APPOINTMENTS,
  ].includes(url) || url.endsWith('/register/entries/')
    ? { data: { results: [], count: 0, next: null, previous: null } }
    : null;
}

function show(role: AccountRole = 'company', content: ReactNode = <CompanyRegisterPage />, title = 'Register') {
  prepareCompanyClient(client, role);
  client.setQueryData(['userAccount'], { data: { role } });
  return renderCompanyPage(client, content, title);
}

function serve(value = register()) {
  api.get.mockImplementation(async (url: string) => noCommands(url) ?? (url === REGISTER ? page() : { data: value }));
}

function readUrls() {
  return api.get.mock.calls.map(([url]) => String(url));
}

beforeEach(() => {
  api.get.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('reads every register class page and renders exact stored shares with each member and linked wallet', async () => {
  api.get.mockImplementation(async (url: string, config?: { params?: { page: number } }) => {
    if (url === REGISTER)
      return config?.params?.page === 2
        ? page([harbour('preference')])
        : page([harbour('ordinary')], 'https://example.test/tokens/register/?page=2');
    return noCommands(url) ?? { data: register(url.includes('preference') ? 'preference' : 'ordinary') };
  });
  show();
  expect(await screen.findByRole('heading', { name: /^Preference shares ·/ })).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith(REGISTER, { params: { page: 1 } });
  expect(api.get).toHaveBeenCalledWith(REGISTER, { params: { page: 2 } });
  expect(screen.queryByLabelText('Company')).toBeNull();
  expect(screen.getAllByRole('heading', { name: 'Current members · 1' })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /Ordinary shares|Preference shares/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
  expect(screen.getAllByText('9,007,199,254,740,993 shares')).toHaveLength(2);
  expect(screen.getAllByText('9,007,199,254,740,999')).toHaveLength(2);
  expect(screen.getAllByText('Example Member')).toHaveLength(2);
  for (const name of [/^Ordinary shares ·/, /^Preference shares ·/]) {
    const section = screen.getByRole('heading', { name }).closest('section')!;
    const wallet = within(section).getByText('Optional wallet links').closest('details')!;
    const history = within(section).getByText('Other changes and register history').closest('details')!;
    expect(wallet.open).toBe(false);
    expect(history.open).toBe(false);
    fireEvent.click(within(wallet).getByText('Optional wallet links'));
    fireEvent.click(within(history).getByText('Other changes and register history'));
    expect(wallet.open).toBe(true);
    expect(history.open).toBe(true);
    expect(within(wallet).getByText(`0x${'1'.repeat(40)} · Active`)).toBeTruthy();
  }
  expect(screen.getAllByRole('link', { name: 'Share class' }).map((link) => link.getAttribute('href'))).toEqual([
    '/company/register/ordinary',
    '/company/register/preference',
  ]);
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'));
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'));
  expect(readUrls()).not.toContain(COMPANY_TOKEN_ENDPOINTS.BASE);
});

it('does not present an unopened register as an empty opened register, zero issued shares or a download', async () => {
  serve(
    register('ordinary', {
      initialized: false,
      issuedSupply: null,
      holders: [],
      totalHolders: 0,
      waitingEffects: null,
    }),
  );
  show(
    'company',
    <>
      <CompanyRegisterPage />
      <Link to="#documents">Company documents</Link>
    </>,
  );
  await screen.findByRole('heading', { name: /^Ordinary shares ·/ });
  expect(screen.getByText('Not opened')).toBeTruthy();
  expect(screen.getByText('Not recorded')).toBeTruthy();
  expect(screen.queryByText(/Current members/)).toBeNull();
  expect(screen.getByText(REGISTER_COPY.NOT_OPENED_NOTE)).toBeTruthy();
  expect(screen.queryByText('0 issued shares')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Company documents' }));
  expect(await screen.findByRole('heading', { name: 'Documents' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Download CSV' }) as HTMLButtonElement).disabled).toBe(true);
});

it('shows an account without register access a calm empty state, reads no members or CSV and offers no entry', async () => {
  api.get.mockImplementation(async (url: string) => {
    if (url === REGISTER) return page([]);
    throw new Error(`Unexpected read ${url}`);
  });
  show('investor');
  expect(await screen.findByText(NO_REGISTER)).toBeTruthy();
  expect(screen.queryByLabelText('Company')).toBeNull();
  expect(screen.queryByRole('button', { name: /shares/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
  cleanup();
  show('investor', <SettingsPage />, 'Settings');
  expect(await screen.findByRole('link', { name: /Company team/ })).toBeTruthy();
  await waitFor(() => expect(readUrls()).toEqual([REGISTER, REGISTER]));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.queryByRole('link', { name: 'Register' })).toBeNull();
});

it("lets a person who can read several companies choose one and reads only that company's members", async () => {
  api.get.mockImplementation(async (url: string) => {
    if (url === REGISTER) return page([harbour('ordinary'), inland('preference')]);
    return noCommands(url) ?? { data: register(url.includes('preference') ? 'preference' : 'ordinary') };
  });
  show('investor');
  const select = (await screen.findByLabelText('Company')) as HTMLSelectElement;
  expect([...select.options].map((option) => option.textContent)).toEqual([
    'Select a company',
    'Harbour Example Pty Ltd',
    'Inland Example Pty Ltd',
  ]);
  expect(select.value).toBe('');
  expect(screen.getByText('Select a company to show its register.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /shares/ })).toBeNull();
  expect(readUrls()).toEqual([REGISTER]);

  fireEvent.change(select, { target: { value: 'inland' } });
  const preference = await screen.findByRole('heading', { name: /^Preference shares ·/ });
  expect(within(preference.closest('section')!).getByText(/^Inland Example Pty Ltd ·/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /^Ordinary shares ·/ })).toBeNull();
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'));
  expect(readUrls()).not.toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'));

  fireEvent.change(select, { target: { value: 'harbour' } });
  const ordinary = await screen.findByRole('heading', { name: /^Ordinary shares ·/ });
  expect(within(ordinary.closest('section')!).getByText(/^Harbour Example Pty Ltd ·/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /^Preference shares ·/ })).toBeNull();
  expect(
    readUrls().filter(
      (url) =>
        url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference') || url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'),
    ),
  ).toEqual([COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'), COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary')]);
  expect(readUrls()).not.toContain(COMPANY_TOKEN_ENDPOINTS.BASE);
  for (const read of [PARTICULARS, LINKS])
    expect(api.get.mock.calls.filter(([url]) => url === read).map(([, config]) => config.params.company)).toEqual([
      'inland',
      'harbour',
    ]);
});

it("starts again for another signed-in account without showing the previous account's register or choice", async () => {
  api.get.mockImplementation(async (url: string) => {
    if (url === REGISTER) return page([harbour('ordinary'), inland('preference')]);
    return { data: register(url.includes('preference') ? 'preference' : 'ordinary') };
  });
  show('investor');
  fireEvent.change(await screen.findByLabelText('Company'), { target: { value: 'inland' } });
  expect(await screen.findByRole('heading', { name: /^Preference shares ·/ })).toBeTruthy();

  let finish!: (response: ReturnType<typeof page>) => void;
  api.get.mockImplementation((url: string) =>
    url === REGISTER
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ data: register(url.includes('preference') ? 'preference' : 'ordinary') }),
  );
  const other = companyPreferences('investor');
  act(() =>
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { ...other, userProfile: 'profile-two', userAccount: { ...other.userAccount!, uuid: 'account-two' } },
    }),
  );
  expect(screen.getByRole('status').textContent).toBe('Loading your register…');
  expect(screen.queryByRole('heading', { name: /^Preference shares ·/ })).toBeNull();
  expect(screen.queryByLabelText('Company')).toBeNull();
  await act(async () => finish(page([harbour('ordinary'), inland('preference')])));
  expect(((await screen.findByLabelText('Company')) as HTMLSelectElement).value).toBe('');
  expect(screen.queryByRole('heading', { name: /^Preference shares ·/ })).toBeNull();
  expect(screen.getByText('Select a company to show its register.')).toBeTruthy();
  expect(readUrls().filter((url) => url === REGISTER)).toHaveLength(2);
});

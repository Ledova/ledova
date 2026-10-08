// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AUTH_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS,
  REGISTER_COPY,
  USER_PREFERENCES_ENDPOINTS,
  USER_PREFERENCES_QUERY_KEY,
  type AccountRole,
  type FormerMember,
  type TokenHoldersResponse,
} from '@ledova/shared';
import SettingsPage from '@pages/settings';
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

function detailOf(row: HTMLElement) {
  const detail = document.getElementById(row.getAttribute('aria-controls') ?? '');
  expect(detail).not.toBeNull();
  return detail!;
}

async function openOrdinary() {
  fireEvent.click(await screen.findByRole('button', { name: /Ordinary shares/ }));
}

function stubDownloads() {
  const create = vi.fn(() => 'blob:synthetic');
  const revoke = vi.fn();
  const saved: string[] = [];
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download);
  });
  return { create, revoke, saved };
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

it('keeps its title and a loading state until the class list resolves, then says calmly that nothing is readable', async () => {
  let finish!: (response: ReturnType<typeof page>) => void;
  api.get.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  show();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Register');
  expect(screen.getByRole('status').textContent).toBe('Loading your register…');
  expect(screen.queryByText(NO_REGISTER)).toBeNull();
  await act(async () => finish(page([])));
  expect(await screen.findByText(NO_REGISTER)).toBeTruthy();
  expect(screen.getByText(/with exact company approval/)).toBeTruthy();
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
  expect(await screen.findByText('Preference shares')).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith(REGISTER, { params: { page: 1 } });
  expect(api.get).toHaveBeenCalledWith(REGISTER, { params: { page: 2 } });
  expect(screen.queryByLabelText('Company')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Ordinary shares/ }));
  fireEvent.click(screen.getByRole('button', { name: /Preference shares/ }));
  expect(screen.getAllByRole('link', { name: 'Share class' }).map((link) => link.getAttribute('href'))).toEqual([
    '/company/register/ordinary',
    '/company/register/preference',
  ]);
  expect(screen.getAllByText('9,007,199,254,740,993 shares')).toHaveLength(2);
  expect(screen.getAllByText('9,007,199,254,740,999')).toHaveLength(2);
  expect(screen.getAllByText('Example Member')).toHaveLength(2);
  expect(screen.getAllByText(`0x${'1'.repeat(40)} · Active`)).toHaveLength(2);
  for (const name of [/Ordinary shares/, /Preference shares/]) {
    expect(within(detailOf(screen.getByRole('button', { name }))).queryByText(/AUD|USD/)).toBeNull();
  }
  expect(readUrls()).toEqual([
    REGISTER,
    REGISTER,
    COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'),
    COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'),
    PARTICULARS,
    APPOINTMENTS,
    LINKS,
    OPENINGS,
    IMPORTS,
    GRANTS,
    TRANSFERS,
    COMPANY_TOKEN_ENDPOINTS.REGISTER_ENTRIES('ordinary'),
    CORRECTIONS,
    RECONCILIATIONS,
    OPENINGS,
    IMPORTS,
    GRANTS,
    TRANSFERS,
    COMPANY_TOKEN_ENDPOINTS.REGISTER_ENTRIES('preference'),
    CORRECTIONS,
    RECONCILIATIONS,
  ]);
  expect(readUrls()).not.toContain(COMPANY_TOKEN_ENDPOINTS.BASE);
});

it.each(['class list', 'class page two', 'register'])(
  'hides partial data when the %s fails and retries the complete read',
  async (failure) => {
    let failed = true;
    api.get.mockImplementation(async (url: string, config?: { params?: { page: number } }) => {
      if (url === REGISTER) {
        if (config?.params?.page === 2) {
          if (failed && failure === 'class page two') throw new Error('Unavailable');
          return page([harbour('preference')]);
        }
        if (failed && failure === 'class list') throw new Error('Unavailable');
        return page([harbour('ordinary')], 'https://example.test/tokens/register/?page=2');
      }
      if (failed && failure === 'register' && url.includes('preference')) throw new Error('Unavailable');
      return { data: register(url.includes('preference') ? 'preference' : 'ordinary') };
    });
    show();
    expect((await screen.findByRole('alert')).textContent).toContain("We couldn't load the complete register.");
    expect(screen.queryByText('Ordinary shares')).toBeNull();
    expect(screen.queryByText(NO_REGISTER)).toBeNull();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Ordinary shares')).toBeTruthy();
    expect(screen.getByText('Preference shares')).toBeTruthy();
  },
);

it('hides stale members after a failed refresh and reflects a successful register invalidation', async () => {
  serve();
  show();
  await openOrdinary();
  expect(screen.getByText('Example Member')).toBeTruthy();
  api.get.mockRejectedValue(new Error('Unavailable'));
  await act(async () => client.invalidateQueries({ queryKey: ['tokens'] }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Example Member')).toBeNull();
  serve(register('ordinary', { holders: [], totalHolders: 0, issuedSupply: '0' }));
  await act(async () => client.invalidateQueries({ queryKey: ['tokens'] }));
  expect(await screen.findByText('No current members are recorded for this class.')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Ordinary shares/ }).getAttribute('aria-expanded')).toBe('true');
  expect(screen.queryByText('Example Member')).toBeNull();
});

it.each([null, 2])('keeps waiting effects %s distinct from a current register', async (waitingEffects) => {
  serve(register('ordinary', { waitingEffects }));
  show();
  await openOrdinary();
  const note = screen.getByText(
    waitingEffects === null ? /could not be checked/ : /2 completed issues or transfers wait/,
  );
  expect(note.getAttribute('role')).toBe('status');
  expect(screen.getByText('Example Member')).toBeTruthy();
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
  show();
  await openOrdinary();
  expect(screen.getByText('Not opened')).toBeTruthy();
  expect(screen.getByText('Not recorded')).toBeTruthy();
  expect(screen.queryByText(/Current members/)).toBeNull();
  expect(screen.getByText(REGISTER_COPY.NOT_OPENED_NOTE)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Download CSV' }) as HTMLButtonElement).disabled).toBe(true);
});

it('shows a walletless cessation and return beside current holdings with exact dates and entry provenance', async () => {
  const former: FormerMember = {
    uuid: 'cessation-a',
    member: 'member-one',
    walletAddress: null,
    name: 'Prior retained identity',
    residentialAddress: '1 Private Synthetic Street',
    sharesAtCessation: '15',
    ceasedOn: '2026-10-05',
    ceasedAtBlock: null,
    identitySource: 'recorded',
    identitySourceDisplay: 'Company register record',
    identityRecordedAt: '2026-10-05T00:00:00Z',
    sourceEntry: 'cessation-entry-a',
    sourceEntrySequence: 3,
    sourceEntryKind: 'CORRECT',
    sourceEffectiveOn: '2020-01-01',
    corrects: 'corrected-entry-a',
    correctedBy: 'later-correction-a',
    returnedEntry: 'return-entry-a',
    returnedOn: '2026-10-07',
  };
  serve(register('ordinary', { formerMembers: [former] }));
  show();
  await openOrdinary();
  expect(screen.getByRole('heading', { name: 'Former-member history · 1' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Current members · 1' })).toBeTruthy();
  expect(screen.getByText('Example Member')).toBeTruthy();
  for (const value of [
    'Prior retained identity',
    'member-one',
    '2026-10-05',
    '2026-10-07',
    '2020-01-01',
    'cessation-entry-a',
    'corrected-entry-a',
    'later-correction-a',
    'return-entry-a',
  ])
    expect(screen.getByText(value)).toBeTruthy();
  expect(screen.queryByText(former.residentialAddress)).toBeNull();
  expect(screen.queryByText('Recorded wallet')).toBeNull();
  expect(screen.queryByText('Recorded cessation block')).toBeNull();
});

it('refuses an inexact retained cessation quantity before presenting the register', async () => {
  const former: FormerMember = {
    uuid: 'cessation-a',
    member: 'member-one',
    walletAddress: null,
    name: 'Prior retained identity',
    residentialAddress: '1 Private Synthetic Street',
    sharesAtCessation: '15',
    ceasedOn: '2026-10-05',
    ceasedAtBlock: null,
    identitySource: 'recorded',
    identitySourceDisplay: 'Company register record',
    identityRecordedAt: '2026-10-05T00:00:00Z',
    sourceEntry: 'cessation-entry-a',
    sourceEntrySequence: 3,
    sourceEntryKind: 'CORRECT',
    sourceEffectiveOn: '2020-01-01',
    corrects: 'corrected-entry-a',
    correctedBy: 'later-correction-a',
    returnedEntry: 'return-entry-a',
    returnedOn: '2026-10-07',
  };
  serve(register('ordinary', { formerMembers: [{ ...former, sharesAtCessation: '1e3' }] }));
  show();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Ordinary shares')).toBeNull();
});

it('retains unresolved identity and wallet-less members without inventing a name', async () => {
  const holder = register().holders[0];
  serve(register('ordinary', { holders: [{ ...holder, name: null, holderType: 'ambiguous', wallets: [] }] }));
  show();
  await openOrdinary();
  expect(screen.getByText('Ambiguous')).toBeTruthy();
  expect(screen.getByText(/wallets point to more than one person/)).toBeTruthy();
  expect(screen.getByText('No linked wallet')).toBeTruthy();
});

it('opens each class in place under its row, all closed at first, independently and from the keyboard', async () => {
  const user = userEvent.setup();
  api.get.mockImplementation(
    async (url: string) =>
      noCommands(url) ??
      (url === REGISTER
        ? page([harbour('ordinary'), harbour('preference')])
        : { data: register(url.includes('preference') ? 'preference' : 'ordinary') }),
  );
  show();
  const ordinary = await screen.findByRole('button', { name: /Ordinary shares/ });
  const preference = screen.getByRole('button', { name: /Preference shares/ });
  for (const row of [ordinary, preference]) {
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(detailOf(row).hidden).toBe(true);
    expect(detailOf(row).textContent).toBe('');
    expect(row.querySelector('a, button, input, select, textarea')).toBeNull();
  }
  expect(screen.queryByRole('link', { name: 'Share class' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
  expect(screen.queryByText('Example Member')).toBeNull();

  fireEvent.click(ordinary);
  const detail = detailOf(ordinary);
  expect(ordinary.getAttribute('aria-expanded')).toBe('true');
  expect(detail.hidden).toBe(false);
  expect(ordinary.closest('li')!.contains(detail)).toBe(true);
  expect(ordinary.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(detail).getByRole('link', { name: 'Share class' }).getAttribute('href')).toBe(
    '/company/register/ordinary',
  );
  expect(within(detail).getByText(REGISTER_COPY.PRIVACY_NOTE)).toBeTruthy();
  expect(within(detail).getByRole('heading', { level: 3, name: 'Current members · 1' })).toBeTruthy();
  expect(within(detail).getByText('Example Member')).toBeTruthy();
  expect(detailOf(preference).textContent).toBe('');
  expect(screen.queryAllByRole('region')).toHaveLength(0);

  ordinary.focus();
  await user.tab();
  expect(document.activeElement).toBe(within(detail).getByRole('link', { name: 'Share class' }));
  await user.tab();
  expect(document.activeElement).toBe(within(detail).getByRole('button', { name: 'Download CSV' }));
  await user.tab();
  expect(document.activeElement).toBe(preference);
  await user.keyboard('{Enter}');
  expect(preference.getAttribute('aria-expanded')).toBe('true');
  expect(within(detailOf(preference)).getByRole('link', { name: 'Share class' }).getAttribute('href')).toBe(
    '/company/register/preference',
  );
  expect(ordinary.getAttribute('aria-expanded')).toBe('true');
  expect(within(detailOf(ordinary)).getByText('Example Member')).toBeTruthy();
  expect(screen.queryAllByRole('region')).toHaveLength(0);

  await user.keyboard(' ');
  expect(preference.getAttribute('aria-expanded')).toBe('false');
  expect(detailOf(preference).hidden).toBe(true);
  expect(detailOf(preference).textContent).toBe('');
  expect(detailOf(ordinary).hidden).toBe(false);
});

it('refuses a next link that names no page, rather than presenting the first page as every class', async () => {
  api.get.mockImplementation(async (url: string) =>
    url === REGISTER
      ? page([harbour('ordinary')], 'https://example.test/tokens/register/?cursor=next')
      : { data: register() },
  );
  show();
  expect((await screen.findByRole('alert')).textContent).toContain("We couldn't load the complete register.");
  expect(screen.queryByText('Ordinary shares')).toBeNull();
});

it.each(['1.5', '-1', '1e3'])('rejects inexact share balance %s instead of publishing it', async (balance) => {
  serve(register('ordinary', { holders: [{ ...register().holders[0], balance }] }));
  show();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Ordinary shares/ })).toBeNull();
  expect(screen.queryByText('Example Member')).toBeNull();
});

it('opens the register and class detail to an investor-role appointee, with members and the CSV', async () => {
  const downloads = stubDownloads();
  let exportFails = true;
  api.get.mockImplementation(async (url: string) => {
    if (url === REGISTER) return page([harbour('ordinary')]);
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_EXPORT('ordinary')) {
      if (exportFails) throw new Error('Unavailable');
      return { data: new Blob(['Synthetic register'], { type: 'text/csv' }) };
    }
    return noCommands(url) ?? { data: register() };
  });
  show('investor');
  await openOrdinary();
  expect(screen.getByText('Harbour Example Pty Ltd')).toBeTruthy();
  expect(screen.getByText('Example Member')).toBeTruthy();
  expect(screen.getByText(REGISTER_COPY.PRIVACY_NOTE)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Share class' }).getAttribute('href')).toBe('/company/register/ordinary');
  fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
  expect(await screen.findByText(REGISTER_COPY.DOWNLOAD_FAILED)).toBeTruthy();
  expect(downloads.create).not.toHaveBeenCalled();
  exportFails = false;
  fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
  await waitFor(() => expect(downloads.saved).toEqual(['register-ORDINARY.csv']));
  expect(downloads.create).toHaveBeenCalledWith(expect.any(Blob));
  expect(downloads.revoke).toHaveBeenCalledWith('blob:synthetic');
  expect(api.get).toHaveBeenCalledWith(COMPANY_TOKEN_ENDPOINTS.REGISTER_EXPORT('ordinary'), {
    responseType: 'blob',
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(readUrls()).not.toContain(COMPANY_TOKEN_ENDPOINTS.BASE);
});

it.each([
  [
    'another account signs in',
    () => {
      const other = companyPreferences('investor');
      client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
        data: { ...other, userProfile: 'profile-two', userAccount: { ...other.userAccount!, uuid: 'account-two' } },
      });
    },
  ],
  ['the session ends', () => client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } })],
])('saves no register CSV whose response arrives after %s', async (_change, retire) => {
  const downloads = stubDownloads();
  const exported = COMPANY_TOKEN_ENDPOINTS.REGISTER_EXPORT('ordinary');
  let finish!: (response: { data: Blob }) => void;
  api.get.mockImplementation((url: string) => {
    if (url === REGISTER) return Promise.resolve(page([harbour('ordinary')]));
    if (url === exported)
      return new Promise((resolve) => {
        finish = resolve;
      });
    return Promise.resolve(noCommands(url) ?? { data: register() });
  });
  show('investor');
  await openOrdinary();
  fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
  await waitFor(() => expect(readUrls()).toContain(exported));
  act(retire);
  await act(async () => finish({ data: new Blob(['Synthetic register'], { type: 'text/csv' }) }));
  expect(downloads.create).not.toHaveBeenCalled();
  expect(downloads.saved).toEqual([]);
});

it('offers an investor-role appointee a Settings entry from the first register page alone', async () => {
  api.get.mockImplementation(async (url: string) => {
    if (url === REGISTER) return page([harbour('ordinary')], 'https://example.test/tokens/register/?page=2');
    throw new Error(`Unexpected read ${url}`);
  });
  show('investor', <SettingsPage />, 'Settings');
  expect((await screen.findByRole('link', { name: 'Register' })).getAttribute('href')).toBe('/company/register');
  expect(screen.getByText('Read the company registers you have access to.')).toBeTruthy();
  expect(api.get.mock.calls).toEqual([[REGISTER, { params: { page: 1 } }]]);
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

it('keeps the company-role Register navigation and adds no Settings entry or access read for it', async () => {
  show('company', <SettingsPage />, 'Settings');
  expect(await screen.findByRole('link', { name: /Company team/ })).toBeTruthy();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.queryByRole('link', { name: 'Register' })).toBeNull();
  expect(api.get).not.toHaveBeenCalled();
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
  const preference = await screen.findByRole('button', { name: /Preference shares/ });
  expect(within(preference).getByText('Inland Example Pty Ltd')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Ordinary shares/ })).toBeNull();
  expect(readUrls()).toEqual([
    REGISTER,
    COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'),
    PARTICULARS,
    APPOINTMENTS,
    LINKS,
  ]);

  fireEvent.change(select, { target: { value: 'harbour' } });
  const ordinary = await screen.findByRole('button', { name: /Ordinary shares/ });
  expect(within(ordinary).getByText('Harbour Example Pty Ltd')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Preference shares/ })).toBeNull();
  expect(readUrls()).toEqual([
    REGISTER,
    COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'),
    PARTICULARS,
    APPOINTMENTS,
    LINKS,
    COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'),
    PARTICULARS,
    LINKS,
  ]);
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
  expect(await screen.findByRole('button', { name: /Preference shares/ })).toBeTruthy();

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
  expect(screen.queryByRole('button', { name: /Preference shares/ })).toBeNull();
  expect(screen.queryByLabelText('Company')).toBeNull();
  await act(async () => finish(page([harbour('ordinary'), inland('preference')])));
  expect(((await screen.findByLabelText('Company')) as HTMLSelectElement).value).toBe('');
  expect(screen.queryByRole('button', { name: /Preference shares/ })).toBeNull();
  expect(screen.getByText('Select a company to show its register.')).toBeTruthy();
  expect(readUrls().filter((url) => url === REGISTER)).toHaveLength(2);
});

it('reads no register until the signed-in account is known, and retries a failed account read', async () => {
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(['userAccount'], { data: { role: 'investor' } });
  let accountFails = true;
  api.get.mockImplementation(async (url: string) => {
    if (url === USER_PREFERENCES_ENDPOINTS.BASE) {
      if (accountFails) throw new Error('Unavailable');
      return { data: companyPreferences('investor') };
    }
    if (url === REGISTER) return page([harbour('ordinary')]);
    return { data: register() };
  });
  renderCompanyPage(client, <CompanyRegisterPage />, 'Register');
  expect((await screen.findByRole('alert')).textContent).toContain("We couldn't load the complete register.");
  expect(readUrls()).toEqual([USER_PREFERENCES_ENDPOINTS.BASE]);
  accountFails = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('button', { name: /Ordinary shares/ })).toBeTruthy();
});

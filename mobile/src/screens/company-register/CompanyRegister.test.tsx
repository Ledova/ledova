import React from 'react';
import { ApiClientProvider, AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  getCompanyTokens,
  HOLDER_TYPE_LABELS,
  REGISTER_COPY,
  type FormerMember,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { cache, files, resetFiles } from '../../testSupport/documentFiles';
import { CompanyRegisterScreen } from './CompanyRegisterScreen';

const mockNavigate = jest.fn();
let mockPreferences: { userAccount?: { role: string }; isLoading: boolean; isError: boolean; refetch: jest.Mock };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  getCompanyTokens: jest.fn(),
  useUserPreferences: () => mockPreferences,
}));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn() } }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));

const EMPTY =
  'There is no company register to show. Share classes appear here for companies you own or where your company appointment includes register access.';
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const get = jest.mocked(apiClient.get);
const shareClass = {
  uuid: 'ordinary',
  name: 'Ordinary shares',
  symbol: 'ORD',
  companyUuid: 'paper',
  companyName: 'Paper Company',
};
const preference = { ...shareClass, uuid: 'preference', name: 'Preference shares', symbol: 'PRF' };
const growth = {
  uuid: 'growth',
  name: 'Growth shares',
  symbol: 'GRO',
  companyUuid: 'garden',
  companyName: 'Garden Company',
};
const register = {
  token: { ...shareClass, totalSupply: '9007199254740995' },
  issuedSupply: '9007199254740993',
  initialized: true,
  waitingEffects: null,
  totalHolders: 2,
  holders: [
    {
      member: 'member-1',
      name: 'Alex Member',
      holderType: 'member',
      balance: '9007199254740992',
      enteredOn: '2026-09-01',
      wallets: [],
    },
    {
      member: 'member-2',
      name: null,
      holderType: 'unidentified',
      balance: '1',
      enteredOn: '2026-09-02',
      wallets: [{ address: `0x${'1'.repeat(40)}`, whitelistStatus: 'active' }],
    },
  ],
};
const registerOf = (target: typeof growth, changes: object) => ({
  ...register,
  token: { ...register.token, ...target },
  ...changes,
});
let client: QueryClient;
let pages: unknown[][];
let read: (url: string, page: number) => Promise<unknown>;
const page = (results: unknown[], next: string | null = null) => ({ data: { results, next, count: results.length } });
function defaultRead(url: string, number: number): Promise<unknown> {
  if (url === URLS.REGISTER)
    return Promise.resolve(
      page(pages[number - 1] ?? [], number < pages.length ? `https://api.example.test/?page=${number + 1}` : null),
    );
  if (url === URLS.HOLDERS('ordinary')) return Promise.resolve({ data: register });
  if (url === URLS.HOLDERS('preference'))
    return Promise.resolve({
      data: registerOf(preference, { initialized: false, issuedSupply: null, holders: [] }),
    });
  if (url === URLS.HOLDERS('growth'))
    return Promise.resolve({
      data: registerOf(growth, { totalHolders: 1, holders: [{ ...register.holders[0], name: 'Gale Member' }] }),
    });
  if (url === URLS.REGISTER_EXPORT('ordinary'))
    return Promise.resolve({ data: Uint8Array.from('member,shares', (c) => c.charCodeAt(0)).buffer });
  if (url === URLS.REGISTER_IMPORTS || url === APPOINTMENTS) return Promise.resolve(page([]));
  if (url === URLS.REGISTER_ENTRIES('ordinary') || url === URLS.REGISTER_CORRECTIONS) return Promise.resolve(page([]));
  if (url === URLS.REGISTER_RECONCILIATIONS) return Promise.resolve(page([]));
  return Promise.reject(new Error(`Unexpected ${url}`));
}
const requested = () => get.mock.calls.map(([url]) => url);
const holderReads = () => requested().filter((url) => url.endsWith('/holders/'));
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockPreferences = { userAccount: { role: 'company' }, isLoading: false, isError: false, refetch: jest.fn() };
  resetFiles();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
  });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } },
  });
  pages = [[shareClass], [preference]];
  read = defaultRead;
  get.mockReset();
  get.mockImplementation(
    (url, config) =>
      read(url, (config?.params as { page?: number } | undefined)?.page ?? 1) as ReturnType<typeof apiClient.get>,
  );
  jest.mocked(Sharing.shareAsync).mockClear();
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

it('shows walletless cessation and return clocks with stable identity and entry provenance beside current holdings', async () => {
  const former: FormerMember = {
    uuid: 'cessation-a',
    member: 'member-1',
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
  read = (url, number) =>
    url === URLS.HOLDERS('ordinary')
      ? Promise.resolve({ data: { ...register, formerMembers: [former], formerMembersStale: false } })
      : defaultRead(url, number);
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(view.getByText('Former-member history · 1')).toBeTruthy();
  expect(view.getByText('Current members · 2')).toBeTruthy();
  expect(view.getByText('Alex Member')).toBeTruthy();
  for (const value of [
    'Prior retained identity',
    'member-1',
    '2026-10-05',
    '2026-10-07',
    '2020-01-01',
    'cessation-entry-a',
    'corrected-entry-a',
    'later-correction-a',
    'return-entry-a',
  ])
    expect(view.getByText(value)).toBeTruthy();
  expect(view.queryByText(former.residentialAddress)).toBeNull();
  expect(view.queryByText('Recorded wallet')).toBeNull();
  expect(view.queryByText('Recorded cessation block')).toBeNull();
});

it('lets an investor appointee read every register class and its members and share the class CSV', async () => {
  mockPreferences.userAccount = { role: 'investor' };
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await view.findByRole('button', { name: 'Preference shares register' });
  const epoch = getSessionEpoch();
  const session = { ledovaSessionEpoch: epoch, signal: expect.objectContaining({ aborted: false }) };
  expect(get.mock.calls.filter(([url]) => url === URLS.REGISTER).map(([, config]) => config)).toEqual([
    { ...session, params: { page: 1 } },
    { ...session, params: { page: 2 } },
  ]);
  expect(get).toHaveBeenCalledWith(URLS.HOLDERS('ordinary'), session);
  expect(get).toHaveBeenCalledWith(URLS.HOLDERS('preference'), session);
  expect(getCompanyTokens).not.toHaveBeenCalled();
  expect(requested()).not.toContain(URLS.BASE);
  expect(view.queryByText('Choose company')).toBeNull();
  expect(view.getByRole('button', { name: 'Open Ordinary shares' })).toBeTruthy();
  expect(view.getByText('Paper Company · ORD')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Ordinary shares register' }));
  expect(view.getByText('Alex Member')).toBeTruthy();
  expect(view.getByText('9,007,199,254,740,992 shares')).toBeTruthy();
  expect(view.getByText(REGISTER_COPY.PRIVACY_NOTE)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Download CSV for Ordinary shares' }));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(`${cache}ledova-document-views-v1/register-ordinary.csv`, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
    }),
  );
  expect(get).toHaveBeenCalledWith(URLS.REGISTER_EXPORT('ordinary'), {
    responseType: 'arraybuffer',
    ledovaSessionEpoch: epoch,
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(files.size).toBe(1);
  await fireEvent.press(view.getByRole('button', { name: 'Preference shares register' }));
  expect(view.getByText(REGISTER_COPY.NOT_OPENED_NOTE)).toBeTruthy();
  expect(view.getByRole('button', { name: 'Download CSV for Preference shares' })).toBeDisabled();
});

it('reads every class and displays exact stored members including members without wallets', async () => {
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await waitFor(() => expect(view.getByRole('button', { name: 'Open Preference shares' })).toBeTruthy());
  expect(get).toHaveBeenCalledWith(URLS.REGISTER, expect.objectContaining({ params: { page: 2 } }));
  expect(getCompanyTokens).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button', { name: 'Ordinary shares register' }));
  expect(view.getByText('9,007,199,254,740,993')).toBeTruthy();
  expect(view.getByText('9,007,199,254,740,992 shares')).toBeTruthy();
  expect(view.getByText('1 share')).toBeTruthy();
  expect(view.getByText(REGISTER_COPY.NO_WALLET)).toBeTruthy();
  expect(view.getByText(REGISTER_COPY.WAITING_UNKNOWN_NOTE)).toBeTruthy();
  expect(view.getByText(REGISTER_COPY.UNIDENTIFIED_NOTE)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Preference shares register' }));
  expect(view.getByText(REGISTER_COPY.NOT_OPENED_NOTE)).toBeTruthy();
  expect(view.getByText('Not recorded')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Open Ordinary shares' }));
  expect(mockNavigate).toHaveBeenLastCalledWith('TokenDetail', { uuid: 'ordinary', name: 'Ordinary shares' });
});

it('draws one rule between classes and none above the card edge', async () => {
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  const lastLink = await view.findByRole('button', { name: 'Open Preference shares' });
  expect(lastLink).not.toHaveStyle({ borderBottomWidth: 1 });
  expect(lastLink.parent!.children).toEqual([lastLink]);
  expect(view.getByRole('button', { name: 'Open Ordinary shares' }).parent!.children).toHaveLength(1);
  expect(view.getByRole('button', { name: 'Ordinary shares register' }).parent).toHaveStyle({ borderBottomWidth: 1 });
  expect(view.getByRole('button', { name: 'Preference shares register' }).parent).toHaveStyle({
    borderBottomWidth: 0,
  });
  await fireEvent.press(view.getByRole('button', { name: 'Preference shares register' }));
  const openLink = view.getByRole('button', { name: 'Open Preference shares' });
  const [link, rule, classRegister] = openLink.parent!.children;
  expect(link).toBe(openLink);
  expect(rule).toHaveStyle({ height: 1 });
  expect(classRegister).toBeTruthy();
  expect(openLink).not.toHaveStyle({ borderBottomWidth: 1 });
  await fireEvent.press(view.getByRole('button', { name: 'Ordinary shares register' }));
  expect(view.getByText('Alex Member').parent).toHaveStyle({ borderBottomWidth: 1 });
  expect(view.getByText(HOLDER_TYPE_LABELS.unidentified).parent).toHaveStyle({ borderBottomWidth: 0 });
});

it.each(['foreign-class', 'fractional-balance', 'holder-read', 'repeated-class'])(
  'refuses incomplete or malformed register %s and retries',
  async (failure) => {
    read = async (url) => {
      if (url === URLS.REGISTER) return page(failure === 'repeated-class' ? [shareClass, shareClass] : [shareClass]);
      if (failure === 'holder-read') throw new Error('Unavailable');
      return {
        data:
          failure === 'foreign-class'
            ? { ...register, token: { ...register.token, uuid: 'foreign' } }
            : failure === 'fractional-balance'
              ? { ...register, holders: [{ ...register.holders[0], balance: '1.5' }] }
              : register,
      };
    };
    const view = await render(<CompanyRegisterScreen />, { wrapper });
    await waitFor(() => expect(view.getByText('We couldn’t load the complete register.')).toBeTruthy());
    expect(view.queryByText(EMPTY)).toBeNull();
    expect(view.queryByRole('button', { name: 'Ordinary shares register' })).toBeNull();
    read = async (url) => (url === URLS.REGISTER ? page([shareClass]) : { data: register });
    await fireEvent.press(view.getByRole('button', { name: 'Retry register' }));
    await waitFor(() => expect(view.getByRole('button', { name: 'Open Ordinary shares' })).toBeTruthy());
  },
);

it('hides old member rows when a refresh fails instead of presenting a complete register', async () => {
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await waitFor(() => expect(view.getByRole('button', { name: 'Ordinary shares register' })).toBeTruthy());
  await fireEvent.press(view.getByRole('button', { name: 'Ordinary shares register' }));
  expect(view.getByText('Alex Member')).toBeTruthy();
  read = async () => {
    throw new Error('Unavailable');
  };
  await act(() => client.invalidateQueries({ queryKey: ['company-tokens'] }));
  await waitFor(() => expect(view.getByText('We couldn’t load the complete register.')).toBeTruthy());
  expect(view.queryByText('Alex Member')).toBeNull();
});

it.each(['investor', 'company'])(
  'shows a %s account without register access an empty register and reads no members or CSV',
  async (role) => {
    mockPreferences.userAccount = { role };
    pages = [[]];
    const view = await render(<CompanyRegisterScreen />, { wrapper });
    await view.findByText(EMPTY);
    const refreshing = () => view.getByTestId('register-screen').props.refreshControl.props.refreshing;
    let release!: (value: unknown) => void;
    read = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    await act(() => view.getByTestId('register-screen').props.refreshControl.props.onRefresh());
    await waitFor(() => expect(refreshing()).toBe(true));
    await act(async () => release(page([])));
    await waitFor(() => expect(refreshing()).toBe(false));
    expect(view.getByText(EMPTY)).toBeTruthy();
    expect(requested()).toEqual([URLS.REGISTER, URLS.REGISTER]);
    expect(view.queryByText('Choose company')).toBeNull();
    expect(view.queryByRole('button', { name: REGISTER_COPY.DOWNLOAD })).toBeNull();
    expect(getCompanyTokens).not.toHaveBeenCalled();
  },
);

it('asks which company to read when several registers are readable and reads only the chosen company', async () => {
  pages = [[shareClass, growth], [preference]];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await view.findByText('Choose a company above.');
  expect(view.getByText('Choose company')).toBeTruthy();
  expect(requested()).toEqual([URLS.REGISTER, URLS.REGISTER]);
  await fireEvent.press(view.getByRole('button', { name: 'Select company Garden Company' }));
  await view.findByRole('button', { name: 'Growth shares register' });
  expect(view.getByRole('button', { name: 'Select company Garden Company' })).toBeSelected();
  expect(view.getByText('Garden Company · GRO')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Ordinary shares register' })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Growth shares register' }));
  expect(view.getByText('Gale Member')).toBeTruthy();
  expect(holderReads()).toEqual([URLS.HOLDERS('growth')]);
  await fireEvent.press(view.getByRole('button', { name: 'Select company Paper Company' }));
  await view.findByRole('button', { name: 'Preference shares register' });
  expect(view.getByRole('button', { name: 'Ordinary shares register' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Growth shares register' })).toBeNull();
  expect(holderReads()).toEqual([URLS.HOLDERS('growth'), URLS.HOLDERS('ordinary'), URLS.HOLDERS('preference')]);
});

it('withdraws company choices while the class list cannot be refreshed and keeps the choice for a retry', async () => {
  pages = [[shareClass, growth]];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Select company Garden Company' }));
  await view.findByRole('button', { name: 'Growth shares register' });
  read = async () => {
    throw new Error('Unavailable');
  };
  await act(() => client.invalidateQueries({ queryKey: ['company-tokens'] }));
  await waitFor(() => expect(view.getByText('We couldn’t load the complete register.')).toBeTruthy());
  expect(view.queryByText('Choose company')).toBeNull();
  expect(view.queryByRole('button', { name: 'Growth shares register' })).toBeNull();
  read = defaultRead;
  await fireEvent.press(view.getByRole('button', { name: 'Retry register' }));
  await view.findByRole('button', { name: 'Growth shares register' });
  expect(view.getByRole('button', { name: 'Select company Garden Company' })).toBeSelected();
  expect(holderReads()).toEqual([URLS.HOLDERS('growth'), URLS.HOLDERS('growth'), URLS.HOLDERS('growth')]);
});

it.each([
  ['class list', URLS.REGISTER],
  ['member', URLS.HOLDERS('ordinary')],
])('drops a %s read that finishes after the session changes', async (_, target) => {
  mockPreferences.userAccount = { role: 'investor' };
  pages = [[shareClass]];
  let late: ((value: unknown) => void) | undefined;
  read = (url, number) =>
    url === target && !late
      ? new Promise((resolve) => {
          late = resolve;
        })
      : defaultRead(url, number);
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await waitFor(() => expect(late).toBeDefined());
  const epoch = getSessionEpoch();
  const retired = get.mock.calls.find(([url]) => url === target)![1]!;
  expect(retired.ledovaSessionEpoch).toBe(epoch);
  pages = [[]];
  await act(() => invalidateSessionScope());
  expect(retired.signal!.aborted).toBe(true);
  await view.findByText(EMPTY);
  expect(get).toHaveBeenLastCalledWith(URLS.REGISTER, expect.objectContaining({ ledovaSessionEpoch: epoch + 1 }));
  await act(async () => late!(target === URLS.REGISTER ? page([shareClass]) : { data: register }));
  expect(view.getByText(EMPTY)).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Ordinary shares register' })).toBeNull();
  expect(view.queryByText('Alex Member')).toBeNull();
  expect(requested().filter((url) => url === URLS.HOLDERS('ordinary'))).toHaveLength(target === URLS.REGISTER ? 0 : 1);
});

it('does not share a register CSV that arrives after the session changes', async () => {
  mockPreferences.userAccount = { role: 'investor' };
  pages = [[shareClass]];
  let late: ((value: unknown) => void) | undefined;
  read = (url, number) =>
    url === URLS.REGISTER_EXPORT('ordinary')
      ? new Promise((resolve) => {
          late = resolve;
        })
      : defaultRead(url, number);
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  await fireEvent.press(view.getByRole('button', { name: 'Download CSV for Ordinary shares' }));
  await waitFor(() => expect(late).toBeDefined());
  await act(() => invalidateSessionScope());
  await view.findByRole('button', { name: 'Ordinary shares register' });
  expect(view.queryByRole('button', { name: 'Download CSV for Ordinary shares' })).toBeNull();
  await act(async () => late!(await defaultRead(URLS.REGISTER_EXPORT('ordinary'), 1)));
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(files.size).toBe(0);
});

it('opens the class from a successful investor register read without a company-role preference', async () => {
  mockPreferences.userAccount = { role: 'investor' };
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await view.findByRole('button', { name: 'Preference shares register' });
  await fireEvent.press(view.getByRole('button', { name: 'Open Preference shares' }));
  expect(mockNavigate).toHaveBeenCalledWith('TokenDetail', { uuid: 'preference', name: 'Preference shares' });
  expect(getCompanyTokens).not.toHaveBeenCalled();
});

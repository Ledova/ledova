import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  getCompanyTokens,
  REGISTER_COPY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  USER_PREFERENCES_QUERY_KEY,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import React from 'react';
import { APPOINTMENT } from '../../../../packages/shared/tests/fixtures/employee-awards';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { cache, files, resetFiles } from '../../testSupport/documentFiles';
import { CompanyRegisterScreen } from './CompanyRegisterScreen';

const mockNavigate = jest.fn();
let mockSection = 'register';
const mockSetParams = jest.fn((params: { section: string }) => {
  mockSection = params.section;
});
let mockPreferences: { userAccount?: { role: string }; isLoading: boolean; isError: boolean; refetch: jest.Mock };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, setParams: mockSetParams }),
  useRoute: () => ({ params: { section: mockSection } }),
}));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  getCompanyTokens: jest.fn(),
  useUserPreferences: () => mockPreferences,
}));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));

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
const registerOf = (target: typeof shareClass, changes: object) => ({
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
  if (url === URLS.REGISTER_EXPORT('ordinary'))
    return Promise.resolve({ data: Uint8Array.from('member,shares', (c) => c.charCodeAt(0)).buffer });
  if (url === APPOINTMENTS)
    return Promise.resolve(
      page([{ ...APPOINTMENT, company: shareClass.companyUuid, capabilities: ['read_register'] }]),
    );
  if (
    [
      URLS.REGISTER_IMPORTS,
      URLS.REGISTER_GRANTS,
      URLS.REGISTER_TRANSFERS,
      URLS.REGISTER_PARTICULARS_CHANGES,
      URLS.REGISTER_LINKS,
    ].includes(url as never)
  )
    return Promise.resolve(page([]));
  if (url === URLS.REGISTER_ENTRIES('ordinary') || url === URLS.REGISTER_CORRECTIONS) return Promise.resolve(page([]));
  if (url === URLS.REGISTER_RECONCILIATIONS) return Promise.resolve(page([]));
  return Promise.reject(new Error(`Unexpected ${url}`));
}
const requested = () => get.mock.calls.map(([url]) => url);
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockPreferences = { userAccount: { role: 'company' }, isLoading: false, isError: false, refetch: jest.fn() };
  mockSection = 'register';
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
  jest.mocked(apiClient.post).mockReset();
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

it('reads the company register and shares its CSV, but refuses a later CSV after the session changes', async () => {
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
  await fireEvent.press(view.getByRole('button', { name: 'Documents' }));
  await view.rerender(<CompanyRegisterScreen />);
  expect(view.getAllByText(REGISTER_COPY.PRIVACY_NOTE).length).toBeGreaterThan(0);
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

  expect(view.getByRole('button', { name: 'Download CSV for Preference shares' })).toBeDisabled();
  let late: ((value: unknown) => void) | undefined;
  read = (url, number) =>
    url === URLS.REGISTER_EXPORT('ordinary')
      ? new Promise((resolve) => {
          late = resolve;
        })
      : defaultRead(url, number);
  jest.mocked(Sharing.shareAsync).mockClear();
  await fireEvent.press(view.getByRole('button', { name: 'Download CSV for Ordinary shares' }));
  await waitFor(() => expect(late).toBeDefined());
  await act(() => invalidateSessionScope());
  await view.findByRole('button', { name: 'Ordinary shares register' });
  mockSection = 'register';
  await view.rerender(<CompanyRegisterScreen />);
  expect(view.queryByRole('button', { name: 'Download CSV for Ordinary shares' })).toBeNull();
  await act(async () => late!(await defaultRead(URLS.REGISTER_EXPORT('ordinary'), 1)));
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

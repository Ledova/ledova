import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  getCompanyTokens,
  REGISTER_COPY,
  REGISTER_IMPORT_COPY,
  TECHNICAL_SHARE_LIMIT,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  USER_PREFERENCES_QUERY_KEY,
  type RegisterImportPreparation,
  type RegisterTransferMembers,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import React from 'react';
import { Text } from 'react-native';
import { APPOINTMENT } from '../../../../packages/shared/tests/fixtures/employee-awards';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { cache, files, resetFiles } from '../../testSupport/documentFiles';
import { CompanyRegisterScreen } from './CompanyRegisterScreen';
import { PrepareRegisterImportScreen } from './PrepareRegisterImportScreen';
import { registerAppointmentsKey, useRegisterAccess } from '../../hooks/useCompanyRegister';
import { registerImportMembersKey } from './useRegisterImportMembers';

const mockNavigate = jest.fn();
let mockSection = 'register';
let mockRouteParams: { tokenUuid: string; companyUuid: string; correctionOf?: string } | undefined;
const mockGoBack = jest.fn();
const mockSetParams = jest.fn((params: { section: string }) => {
  mockSection = params.section;
});
let mockPreferences: { userAccount?: { role: string }; isLoading: boolean; isError: boolean; refetch: jest.Mock };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, setParams: mockSetParams, goBack: mockGoBack }),
  useRoute: () => ({ params: mockRouteParams ?? { section: mockSection } }),
}));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  getCompanyTokens: jest.fn(),
  useUserPreferences: () => mockPreferences,
}));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));

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
let read: (url: string, page: number, token?: string) => Promise<unknown>;
const page = (results: unknown[], next: string | null = null) => ({ data: { results, next, count: results.length } });
function defaultRead(url: string, number: number, token?: string): Promise<unknown> {
  if (url === URLS.REGISTER)
    return Promise.resolve(
      page(pages[number - 1] ?? [], number < pages.length ? `https://api.example.test/?page=${number + 1}` : null),
    );
  if (url === URLS.HOLDERS('ordinary')) return Promise.resolve({ data: register });
  if (url === URLS.REGISTER_MEMBERS('new-class'))
    return Promise.resolve({ data: { members: [], awardRecipients: [] } });
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
  if (url === URLS.REGISTER_IMPORTS)
    return Promise.resolve(
      page(
        token === 'ordinary'
          ? [
              {
                uuid: 'opening-mirror',
                company: shareClass.companyUuid,
                token: shareClass.uuid,
                status: 'applied',
                stage: 'applied',
                sourceReference: 'Company’s existing legal register',
                sourceConfirmed: true,
                correctionOf: null,
                correctionAllowed: false,
                asAt: '2026-09-01',
                createdAt: '2026-09-01T00:00:00Z',
                preparedByName: 'Example Director',
                providedBy: 'company',
                asicIssuedTotal: null,
                asicMemberCount: null,
                decisions: [],
                reviewedAt: '2026-09-01T00:00:00Z',
                rejectionReason: '',
                members: [
                  {
                    member: 'member-1',
                    name: 'Alex Member',
                    residentialAddress: '1 Example Street',
                    shares: register.holders[0]!.balance,
                    enteredOn: '2026-09-01',
                    amountPaid: '0.00',
                    allotments: [
                      {
                        allottedOn: '2020-01-01',
                        shares: register.holders[0]!.balance,
                        shareReference: null,
                        certificateReference: 'certificate-1',
                        amountPaid: '0.00',
                        amountUnpaid: '0.00',
                        fullyPaid: true,
                        beneficiallyHeld: true,
                      },
                    ],
                  },
                ],
                formerMembers: [],
                registerEvidence: null,
                sourceDocument: null,
                asicSnapshot: null,
              },
            ]
          : [],
      ),
    );
  if (
    [URLS.REGISTER_GRANTS, URLS.REGISTER_TRANSFERS, URLS.REGISTER_PARTICULARS_CHANGES, URLS.REGISTER_LINKS].includes(
      url as never,
    )
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

function RegisterAccessState() {
  const access = useRegisterAccess(true);
  return (
    <Text testID="register-access">{JSON.stringify({ allowed: access.allowed, hasClasses: access.hasClasses })}</Text>
  );
}

beforeEach(() => {
  let keys = 0;
  jest
    .mocked(Crypto.randomUUID)
    .mockImplementation(() => `00000000-0000-4000-8000-${String(++keys).padStart(12, '0')}`);
  mockPreferences = { userAccount: { role: 'company' }, isLoading: false, isError: false, refetch: jest.fn() };
  mockSection = 'register';
  mockRouteParams = undefined;
  mockGoBack.mockClear();
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
      read(
        url,
        (config?.params as { page?: number } | undefined)?.page ?? 1,
        (config?.params as { token?: string } | undefined)?.token,
      ) as ReturnType<typeof apiClient.get>,
  );
  jest.mocked(Sharing.shareAsync).mockClear();
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

it('sets up an appointed company without issuing shares, recovers uncertain class creation and refuses exports after the session changes', async () => {
  mockPreferences.userAccount = { role: 'investor' };
  pages = [[]];
  let capability = 'prepare';
  const draftClass = {
    ...shareClass,
    uuid: 'new-class',
    company: shareClass.companyUuid,
    symbol: 'A',
    name: 'Class A',
    tokenType: 'ordinary',
    tokenTypeDisplay: 'Ordinary',
    totalSupply: TECHNICAL_SHARE_LIMIT,
    status: 'draft',
    statusDisplay: 'Draft',
    contractAddress: null,
    chain: null,
    deployedAt: null,
    deploymentTxHash: null,
  };
  const emptyRegister = {
    token: draftClass,
    initialized: false,
    issuedSupply: null,
    totalHolders: 0,
    holders: [],
    formerMembers: [],
    waitingEffects: null,
  };
  read = (url, number, token) => {
    if (url === APPOINTMENTS)
      return Promise.resolve(
        page([
          {
            ...APPOINTMENT,
            company: shareClass.companyUuid,
            companyName: shareClass.companyName,
            capabilities: [capability],
          },
        ]),
      );
    if (url === URLS.HOLDERS(draftClass.uuid)) return Promise.resolve({ data: emptyRegister });
    if (url === URLS.REGISTER_ENTRIES(draftClass.uuid)) return Promise.resolve(page([]));
    return defaultRead(url, number, token);
  };
  const access = await render(<RegisterAccessState />, { wrapper });
  await waitFor(() =>
    expect(access.getByTestId('register-access')).toHaveTextContent('{"allowed":true,"hasClasses":false}'),
  );
  const appointmentKey = registerAppointmentsKey(getSessionEpoch());
  const appointments = client.getQueryData(appointmentKey);
  await act(() =>
    client.setQueryData(appointmentKey, [
      { ...APPOINTMENT, company: shareClass.companyUuid, capabilities: ['prepare'], expiresAt: '2020-01-01T00:00:00Z' },
    ]),
  );
  await waitFor(() =>
    expect(access.getByTestId('register-access')).toHaveTextContent('{"allowed":false,"hasClasses":false}'),
  );
  await act(() =>
    client.setQueryData(appointmentKey, [
      { ...APPOINTMENT, company: shareClass.companyUuid, capabilities: ['prepare'], revokedAt: '2020-01-01T00:00:00Z' },
    ]),
  );
  await waitFor(() =>
    expect(access.getByTestId('register-access')).toHaveTextContent('{"allowed":false,"hasClasses":false}'),
  );
  await act(() => client.setQueryData(appointmentKey, appointments));
  await access.unmount();
  const setup = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await setup.findByRole('button', { name: 'Create share class' }));
  for (const [label, value] of [
    ['Class name', 'Class A'],
    ['Class code', 'A'],
  ])
    await fireEvent.changeText(setup.getByLabelText(label), value);
  jest.mocked(apiClient.post).mockRejectedValueOnce({ response: { status: 503 } });
  await fireEvent.press(setup.getAllByRole('button', { name: 'Create share class' }).at(-1)!);
  await setup.findByText('The request may have created the class. Refresh to check; it will not be submitted again.');
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(apiClient.post).toHaveBeenCalledWith(
    URLS.BASE,
    {
      company: shareClass.companyUuid,
      name: 'Class A',
      symbol: 'A',
      tokenType: 'ordinary',
      totalSupply: TECHNICAL_SHARE_LIMIT,
    },
    { ledovaSessionEpoch: getSessionEpoch(), ledovaSubmissionGuard: expect.any(Function) },
  );
  const setupRead = read;
  read = (url, number, token) =>
    url === URLS.REGISTER ? Promise.reject({ response: { status: 400 } }) : setupRead(url, number, token);
  await fireEvent.press(setup.getByRole('button', { name: 'Refresh share classes' }));
  await setup.findByText('Share classes or your company appointments could not be loaded.');
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(setup.getAllByRole('button', { name: 'Create share class' }).at(-1)).toBeDisabled();
  expect(setup.getByTestId('modal-Create share class')).toBeTruthy();
  read = setupRead;
  pages = [[draftClass]];
  capability = 'read_register';
  await fireEvent.press(setup.getByRole('button', { name: 'Refresh share classes' }));
  await waitFor(() => expect(setup.queryByTestId('modal-Create share class')).toBeNull());
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  expect(setup.queryByRole('button', { name: 'Create share class' })).toBeNull();
  await setup.unmount();
  capability = 'prepare';
  client.removeQueries();
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } },
  });
  mockRouteParams = { tokenUuid: draftClass.uuid, companyUuid: shareClass.companyUuid };
  const opening = await render(<PrepareRegisterImportScreen />, { wrapper });
  await fireEvent.changeText(await opening.findByLabelText('Existing register or source reference'), 'Company records');
  await fireEvent.press(opening.getByRole('button', { name: REGISTER_IMPORT_COPY.SOURCE_CONFIRMATION }));
  await waitFor(() => expect(opening.getByRole('button', { name: 'Prepare for review' })).not.toBeDisabled());
  await fireEvent.press(opening.getByRole('button', { name: 'Add a shareholder' }));
  expect(opening.getByRole('button', { name: 'Prepare for review' })).toBeDisabled();
  await fireEvent.press(opening.getByRole('button', { name: 'Remove shareholder 1' }));
  jest.mocked(apiClient.post).mockImplementationOnce(
    async (_url, body) =>
      ({
        data: {
          ...(body as object),
          uuid: (body as { operationId: string }).operationId,
          token: draftClass.uuid,
          preparingAppointment: APPOINTMENT.uuid,
          registerEvidence: null,
          asicEvidence: null,
          asicIssuedTotal: null,
          asicMemberCount: null,
          authority: 'company_records',
          authorityReference: 'Company records',
          approvingDirector: '',
          correctionOf: null,
          providedBy: 'company',
          members: [],
          formerMembers: [],
        },
      }) as never,
  );
  await fireEvent.press(opening.getByRole('button', { name: 'Prepare for review' }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  const [, request] = jest.mocked(apiClient.post).mock.calls.at(-1)!;
  expect(request).toEqual(
    expect.objectContaining({
      tokenId: draftClass.uuid,
      members: [],
      formerMembers: [],
      sourceConfirmed: true,
      appointment: APPOINTMENT.uuid,
    }),
  );
  expect((request as { correctionOf?: string }).correctionOf).toBeUndefined();
  await opening.unmount();
  const recipient = {
    member: '00000000-0000-4000-8000-000000009999',
    name: 'Riley Award Recipient',
    residentialAddress: '2 Synthetic Street',
  };
  const recorded = {
    member: '00000000-0000-4000-8000-000000008888',
    name: 'Existing Member',
    residentialAddress: '3 Synthetic Street',
    currentShares: '0',
    enteredOn: null,
    lastCeasedOn: null,
    walletless: true,
    particularsRetained: true,
  };
  let identities: RegisterTransferMembers = { members: [recorded], awardRecipients: [recipient] };
  const earlierRead = read;
  read = (url, number, token) =>
    url === URLS.REGISTER_MEMBERS(draftClass.uuid)
      ? Promise.resolve({ data: identities })
      : earlierRead(url, number, token);
  client.removeQueries();
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } },
  });
  const copied = await render(<PrepareRegisterImportScreen />, { wrapper });
  await fireEvent.changeText(
    await copied.findByLabelText('Existing register or source reference'),
    'Original register',
  );
  await fireEvent.press(
    copied.getByRole('button', { name: `Use recorded member ${recorded.name} ${recorded.member}` }),
  );
  expect(copied.getByLabelText('Shareholder 1 Name')).toHaveDisplayValue(recorded.name);
  expect(copied.getByLabelText('Shareholder 1 Name')).toHaveProp('editable', true);
  await fireEvent.press(copied.getByRole('button', { name: 'Remove shareholder 1' }));
  await fireEvent.press(
    copied.getByRole('button', { name: `Use award recipient ${recipient.name} ${recipient.member}` }),
  );
  expect(copied.getByLabelText('Shareholder 1 Name')).toHaveDisplayValue(recipient.name);
  expect(copied.getByLabelText('Shareholder 1 Name')).toHaveProp('editable', false);
  expect(copied.getByLabelText('Shareholder 1 Address')).toHaveDisplayValue(recipient.residentialAddress);
  expect(copied.getByLabelText('Shareholder 1 Address')).toHaveProp('editable', false);
  expect(copied.getByLabelText('Shareholder 1 Original entry date (YYYY-MM-DD)')).toHaveDisplayValue('');
  expect(copied.getByLabelText('Shareholder 1 shares')).toHaveDisplayValue('');
  for (const [label, value] of [
    ['Register date', '2026-09-01'],
    ['Shareholder 1 Original entry date (YYYY-MM-DD)', '2020-01-01'],
    ['Shareholder 1 shares', '100'],
    ['Shareholder 1 · allotment 1 Original allotment date (YYYY-MM-DD)', '2020-01-01'],
    ['Shareholder 1 · allotment 1 Shares from this allotment still held', '100'],
    ['Shareholder 1 · allotment 1 Total amount paid on these shares', '0'],
    ['Shareholder 1 · allotment 1 Total amount unpaid on these shares', '0'],
  ])
    await fireEvent.changeText(copied.getByLabelText(label), value);
  await fireEvent.press(copied.getByRole('radio', { name: 'Shareholder 1 · allotment 1 own benefit' }));
  await fireEvent.press(copied.getByRole('button', { name: REGISTER_IMPORT_COPY.SOURCE_CONFIRMATION }));
  await waitFor(() => expect(copied.getByRole('button', { name: 'Prepare for review' })).not.toBeDisabled());
  const key = registerImportMembersKey(
    { userUuid: 'native-user', ownerAccountUuid: 'native-account' },
    getSessionEpoch(),
    shareClass.companyUuid,
    draftClass.uuid,
  );
  identities = { members: [recorded], awardRecipients: [] };
  await act(() => client.refetchQueries({ queryKey: key }));
  await waitFor(() => expect(copied.getByRole('button', { name: 'Prepare for review' })).toBeDisabled());
  expect(
    copied.getByText('The selected award recipient changed. Refresh the company records before continuing.'),
  ).toBeTruthy();
  identities = { members: [recorded], awardRecipients: [{ ...recipient, name: 'Conflicting recipient' }] };
  await act(() => client.refetchQueries({ queryKey: key }));
  await waitFor(() => expect(copied.getByRole('button', { name: 'Prepare for review' })).toBeDisabled());
  identities = { members: [recorded], awardRecipients: [recipient] };
  await act(() => client.refetchQueries({ queryKey: key }));
  await waitFor(() => expect(copied.getByRole('button', { name: 'Prepare for review' })).not.toBeDisabled());
  jest.mocked(apiClient.post).mockImplementationOnce(
    async (_url, body) =>
      ({
        data: {
          ...(body as object),
          uuid: (body as { operationId: string }).operationId,
          token: draftClass.uuid,
          preparingAppointment: APPOINTMENT.uuid,
          registerEvidence: null,
          asicEvidence: null,
          asicIssuedTotal: null,
          asicMemberCount: null,
          authority: 'company_records',
          authorityReference: 'Original register',
          members: (body as RegisterImportPreparation).members.map((row) => ({ ...row, amountPaid: '0.00' })),
          approvingDirector: '',
          correctionOf: null,
          providedBy: 'company',
        },
      }) as never,
  );
  await fireEvent.press(copied.getByRole('button', { name: 'Prepare for review' }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(2));
  const copiedGuard = jest.mocked(apiClient.post).mock.calls.at(-1)![2]?.ledovaSubmissionGuard;
  expect(copiedGuard).toEqual(expect.any(Function));
  await act(() => client.setQueryData(key, { members: [], awardRecipients: [] }));
  expect(() => copiedGuard?.()).toThrow('Refresh the company member identities before continuing.');
  const copiedRequest = jest.mocked(apiClient.post).mock.calls.at(-1)![1];
  expect(copiedRequest).toEqual(
    expect.objectContaining({
      members: [expect.objectContaining({ ...recipient, shares: '100', enteredOn: '2020-01-01' })],
    }),
  );
  expect((copiedRequest as { members: object[] }).members[0]).not.toHaveProperty('awardRecipient');
  await copied.unmount();
  mockRouteParams = undefined;
  client.removeQueries();
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } },
  });
  pages = [[shareClass], [preference]];
  read = defaultRead;
  get.mockClear();
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
  expect(view.getAllByText('Alex Member').length).toBeGreaterThan(0);
  expect(view.getByText('Company’s existing legal register')).toBeTruthy();
  expect(view.getByText('certificate-1')).toBeTruthy();
  expect(view.getByText('Holder’s own benefit')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Correct opening records for Ordinary shares' })).toBeNull();
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

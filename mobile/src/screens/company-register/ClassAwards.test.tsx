import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_AWARD_COPY as COPY,
  REGISTER_GRANT_COPY as GRANT_COPY,
  USER_PREFERENCES_QUERY_KEY,
} from '@ledova/shared';
import type {
  OwnCompanyAppointment,
  RegisterAward,
  RegisterAwardPreparation,
  RegisterAwardVesting,
  RegisterAwardVestingPreparation,
  RegisterAwardEnd,
  RegisterAwardVestingReversal,
  RegisterAwardEndPreparation,
  RegisterAwardVestingReversalPreparation,
  RegisterGrant,
  RegisterGrantPreparation,
  RegisterGrantDecideRequest,
  RegisterGrantDecisionPreview,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import React from 'react';
import { View } from 'react-native';
import {
  APPOINTMENT,
  AWARD_REQUEST,
  REGISTER,
  awardFrom,
  vestingFrom,
  endFrom,
  vestingReversalFrom,
} from '../../../../packages/shared/tests/fixtures/employee-awards';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { files, pickedFile, resetFiles } from '../../testSupport/documentFiles';
import { ClassAwards } from './ClassAwards';
import { CompanyRegisterScreen } from './CompanyRegisterScreen';
import { PrepareRegisterGrantScreen } from './PrepareRegisterGrantScreen';
import { registerKey } from '../../hooks/useCompanyRegister';
import { awardsKey, awardVestingsKey, awardEndsKey } from './useRegisterAwards';

type RouteParams = { section?: string; companyUuid?: string; tokenUuid?: string; awardUuid?: string };
const mockRouteContext = React.createContext<{ params: RouteParams }>({ params: { section: 'awards' } });
let mockNavigate: (name: string, params: RouteParams) => void;
let mockSetParams: (params: RouteParams) => void;
let mockDispatch: (action: { type: string; payload: { name: string; params: RouteParams } }) => void;
const mockNavigation = {
  navigate: jest.fn((name: string, params: RouteParams) => mockNavigate(name, params)),
  setParams: jest.fn((params: RouteParams) => mockSetParams(params)),
  dispatch: jest.fn((action: { type: string; payload: { name: string; params: RouteParams } }) => mockDispatch(action)),
};

jest.mock('@react-navigation/native', () => {
  const react = jest.requireActual('react') as typeof React;
  return {
    StackActions: jest.requireActual('@react-navigation/native').StackActions,
    useRoute: () => react.useContext(mockRouteContext),
    useNavigation: () => mockNavigation,
    usePreventRemove: jest.fn(),
  };
});
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../services/tokenStorage', () => ({ getAccessToken: jest.fn(async () => 'synthetic-access') }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));

const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const preferences = { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } };
const OTHER_COMPANY = {
  uuid: 'other-class',
  name: 'Other shares',
  symbol: 'OTHER',
  companyUuid: 'other-company',
  companyName: 'Other Company',
};
let client: QueryClient;
let appointments: OwnCompanyAppointment[];
let awards: RegisterAward[];
let events: RegisterAwardVesting[];
let ends: RegisterAwardEnd[];
let reversals: RegisterAwardVestingReversal[];
let mismatchedEndReceipt: boolean;
let grants: RegisterGrant[];
let failedRead: 'award' | 'vesting' | 'grant' | 'change' | null;
let failedPreferences: boolean;
let failedClasses: boolean;
let listed: boolean;
let pendingFileRelease: (() => void) | undefined;
let append: jest.SpyInstance<ReturnType<FormData['append']>, Parameters<FormData['append']>>;
const submissions = (url: string) => post.mock.calls.filter(([endpoint]) => endpoint === url).map(([, body]) => body);

function field(form: unknown, key: string) {
  return append.mock.calls
    .filter((_, index) => append.mock.contexts[index] === form)
    .find(([name]) => name === key)?.[1];
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

function CompanyJourney() {
  const [params, setParams] = React.useState<RouteParams>({ section: 'awards' });
  const [preparation, setPreparation] = React.useState<RouteParams>();
  React.useEffect(() => {
    mockSetParams = (next) => setParams((current) => ({ ...current, ...next }));
    mockNavigate = (name, next) => {
      expect(name).toBe('PrepareRegisterGrant');
      setPreparation(next);
    };
    mockDispatch = (action) => {
      expect(action.type).toBe('POP_TO');
      expect(action.payload.name).toBe('CompanyMain');
      setParams(action.payload.params);
      setPreparation(undefined);
    };
  }, []);
  return (
    <>
      <View style={preparation ? { display: 'none' } : undefined}>
        <mockRouteContext.Provider value={{ params }}>
          <CompanyRegisterScreen />
        </mockRouteContext.Provider>
      </View>
      {preparation && (
        <mockRouteContext.Provider value={{ params: preparation }}>
          <PrepareRegisterGrantScreen />
        </mockRouteContext.Provider>
      )}
    </>
  );
}

function grantFrom(body: RegisterGrantPreparation): RegisterGrant {
  return {
    uuid: body.operationId,
    company: APPOINTMENT.company,
    token: body.tokenId,
    award: body.award ?? null,
    member: body.member,
    newMember: body.newMember,
    name: body.name || awards[0].name,
    residentialAddress: body.residentialAddress || awards[0].residentialAddress,
    shares: body.shares,
    companyEventOn: body.companyEventOn,
    termsOn: body.termsOn,
    terms: body.terms,
    approvingDirector: body.approvingDirector,
    authorityReference: body.authorityReference,
    reason: body.reason,
    authorityEvidence: body.authorityEvidence,
    termsEvidence: body.termsEvidence,
    acceptanceRequired: body.acceptanceRequired,
    acceptanceEvidence: body.acceptanceEvidence ?? null,
    evidenceFingerprint: 'a'.repeat(64),
    termsFingerprint: 'a'.repeat(64),
    acceptanceFingerprint: '',
    evidenceSnapshot: {},
    termsSnapshot: {},
    acceptanceSnapshot: {},
    preparingAppointment: body.appointment,
    preparedByName: 'Synthetic Preparer',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    registerEntry: null,
    effectiveOn: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    createdAt: '2026-10-07T00:00:00Z',
  };
}

beforeEach(() => {
  resetFiles();
  let keys = 0;
  let picks = 0;
  jest
    .mocked(Crypto.randomUUID)
    .mockImplementation(
      () => `00000000-0000-4000-8000-${String(++keys).padStart(12, '0')}` as ReturnType<typeof Crypto.randomUUID>,
    );
  jest
    .mocked(DocumentPicker.getDocumentAsync)
    .mockReset()
    .mockImplementation(async () => pickedFile(++picks));
  jest.mocked(Sharing.shareAsync).mockClear();
  mockNavigation.navigate.mockClear();
  mockNavigation.dispatch.mockClear();
  mockNavigation.setParams.mockClear();
  append = jest.spyOn(FormData.prototype, 'append');
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } },
  });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  appointments = [APPOINTMENT];
  awards = [];
  events = [];
  ends = [];
  reversals = [];
  mismatchedEndReceipt = false;
  grants = [];
  failedRead = null;
  failedPreferences = false;
  failedClasses = false;
  listed = true;
  get.mockReset().mockImplementation(async (url, config) => {
    if (url === '/api/user-preferences/') {
      if (failedPreferences) throw new Error('Synthetic preferences unavailable');
      return { data: preferences };
    }
    if (url === URLS.REGISTER) {
      if (failedClasses) throw new Error('Synthetic class list unavailable');
      return {
        data: {
          results: [
            ...(listed
              ? [
                  {
                    uuid: REGISTER.token.uuid,
                    name: REGISTER.token.name,
                    symbol: REGISTER.token.symbol,
                    companyUuid: APPOINTMENT.company,
                    companyName: APPOINTMENT.companyName,
                  },
                ]
              : []),
            OTHER_COMPANY,
          ],
          next: null,
        },
      };
    }
    if (url === URLS.HOLDERS(REGISTER.token.uuid))
      return {
        data: grants[0]?.registerEntry
          ? {
              ...REGISTER,
              issuedSupply: '100',
              totalHolders: 1,
              holders: [
                {
                  member: grants[0].member,
                  name: grants[0].name,
                  holderType: 'member',
                  balance: '100',
                  enteredOn: '2026-10-11',
                  wallets: [],
                },
              ],
            }
          : REGISTER,
      };
    if (url === URLS.HOLDERS(OTHER_COMPANY.uuid))
      return {
        data: { ...REGISTER, token: { ...REGISTER.token, uuid: OTHER_COMPANY.uuid, name: OTHER_COMPANY.name } },
      };
    if (url === '/api/v1/company-authority/appointments/') return { data: { results: appointments, next: null } };
    if (url === URLS.REGISTER_AWARDS) {
      if (failedRead === 'award') throw new Error('Recorded awards could not be refreshed');
      return {
        data: {
          results: (config?.params as { token?: string } | undefined)?.token === OTHER_COMPANY.uuid ? [] : awards,
          next: null,
        },
      };
    }
    if (awards[0] && url === URLS.REGISTER_AWARD(awards[0].uuid)) return { data: awards[0] };
    if (url === URLS.REGISTER_AWARD_VESTINGS) {
      if (failedRead === 'vesting') throw new Error('Recorded vesting could not be refreshed');
      return { data: { results: events, next: null } };
    }
    if (url === URLS.REGISTER_AWARD_ENDS || url === URLS.REGISTER_AWARD_VESTING_REVERSALS) {
      if (failedRead === 'change') throw new Error('Award changes could not be refreshed');
      return { data: { results: url === URLS.REGISTER_AWARD_ENDS ? ends : reversals, next: null } };
    }
    if (ends[0] && url === URLS.REGISTER_AWARD_END(ends[0].uuid))
      return { data: { ...ends[0], ...(mismatchedEndReceipt ? { evidenceFingerprint: 'b'.repeat(64) } : {}) } };
    if (reversals[0] && url === URLS.REGISTER_AWARD_VESTING_REVERSAL(reversals[0].uuid)) return { data: reversals[0] };
    if (events[0] && url === URLS.REGISTER_AWARD_VESTING(events[0].uuid)) return { data: events[0] };
    if (events[0] && url === URLS.REGISTER_AWARD_VESTING_FILE(events[0].uuid))
      return new Promise((resolve) => {
        pendingFileRelease = () =>
          resolve({ data: new Uint8Array([37, 80, 68, 70]).buffer, headers: { 'content-type': 'application/pdf' } });
      });
    if (url === URLS.REGISTER_GRANTS) {
      if (failedRead === 'grant') throw new Error('Prepared grants could not be refreshed');
      return {
        data: {
          results: (config?.params as { token?: string } | undefined)?.token === OTHER_COMPANY.uuid ? [] : grants,
          next: null,
        },
      };
    }
    if (url === URLS.REGISTER_MEMBERS(REGISTER.token.uuid))
      return {
        data: {
          members: [],
          awardRecipients: [
            {
              member: AWARD_REQUEST.member,
              name: AWARD_REQUEST.name,
              residentialAddress: AWARD_REQUEST.residentialAddress,
            },
          ],
        },
      };
    if (url === URLS.REGISTER_LINK_WAITING_WALLETS) return { data: { wallets: [] } };
    return { data: { results: [], next: null } };
  });
  post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_EVIDENCE)
      return {
        data: {
          uuid: `evidence-${field(body, 'idempotency_key')}`,
          company: field(body, 'company_id'),
          appointment: field(body, 'appointment'),
          kind: field(body, 'kind'),
          idempotencyKey: field(body, 'idempotency_key'),
          originalFilename: (field(body, 'file') as unknown as { name: string }).name,
          fileSize: 5,
          mimeType: 'application/pdf',
          sha256: 'a'.repeat(64),
          providedBy: 'company',
          createdAt: '2026-10-07T00:00:00Z',
        },
      };
    if (url === URLS.REGISTER_AWARDS) {
      awards = [awardFrom(body as RegisterAwardPreparation)];
      failedRead = 'award';
      throw new Error('Synthetic interrupted award response');
    }
    if (url === URLS.REGISTER_AWARD_VESTINGS) {
      const event = vestingFrom(body as RegisterAwardVestingPreparation);
      events = [event];
      awards = [
        {
          ...awards[0],
          vestedShares: event.shares,
          availableShares: event.shares,
          unvestedRemainingShares: (BigInt(awards[0].shares) - BigInt(event.shares)).toString(),
        },
      ];
      failedRead = 'vesting';
      throw new Error('Synthetic interrupted vesting response');
    }
    if (url === URLS.REGISTER_GRANTS) {
      grants = [grantFrom(body as RegisterGrantPreparation)];
      failedRead = 'grant';
      return { data: { ...grants[0], termsFingerprint: 'c'.repeat(64) } };
    }
    if (grants[0] && url === URLS.REGISTER_GRANT_PREVIEW(grants[0].uuid)) {
      const applying = (body as { kind: string }).kind === 'apply';
      const preview: RegisterGrantDecisionPreview = {
        ...grants[0],
        award: awards[0].uuid,
        awardPromisedShares: awards[0].shares,
        awardVestedShares: awards[0].vestedShares,
        awardIssuedShares: awards[0].issuedShares,
        awardAvailableShares: awards[0].availableShares,
        effectiveOn: grants[0].companyEventOn,
        previewDigest: 'b'.repeat(64),
        canDecide: true,
        unmetRequirements: [],
        registerSequence: 1,
        currentShares: '0',
        afterShares: applying ? '100' : '0',
        issuedSupply: '0',
        afterIssuedSupply: applying ? '100' : '0',
        authorisedSupply: '1000',
      };
      return { data: preview };
    }
    if (grants[0] && url === URLS.REGISTER_GRANT_DECIDE(grants[0].uuid)) {
      const request = body as RegisterGrantDecideRequest;
      if (!grants[0].decisions.some((decision) => decision.idempotencyKey === request.idempotencyKey)) {
        grants = [
          {
            ...grants[0],
            decisions: [
              ...grants[0].decisions,
              {
                uuid: request.idempotencyKey,
                appointment: request.appointment,
                kind: request.kind,
                digest: request.previewDigest,
                idempotencyKey: request.idempotencyKey,
                reason: request.reason || '',
                decidedAt: '2026-10-11T00:00:00Z',
                decidedBy: 1,
                decidedByName: 'Synthetic Appointee',
              },
            ],
            ...(request.kind === 'apply'
              ? {
                  status: 'applied',
                  stage: 'applied',
                  registerEntry: 'entry-a',
                  effectiveOn: grants[0].companyEventOn,
                  reviewedAt: '2026-10-11T00:00:00Z',
                  reviewedBy: 1,
                }
              : { stage: 'approved' }),
          },
        ];
        if (request.kind === 'apply') {
          awards = [{ ...awards[0], issuedShares: '100', availableShares: '0', remainingUnissuedShares: '0' }];
          failedRead = 'grant';
          throw new Error('Synthetic interrupted issue response');
        }
      }
      return { data: grants[0] };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(async () => {
  await act(async () => pendingFileRelease?.());
  pendingFileRelease = undefined;
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

it('recovers captured award, vesting and issue requests under read access and returns to the original company before separate approval and issue', async () => {
  const view = await render(<CompanyJourney />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: `Select company ${OTHER_COMPANY.companyName}` }));
  await view.findByRole('header', { name: OTHER_COMPANY.name });
  await fireEvent.press(view.getByRole('button', { name: `Select company ${APPOINTMENT.companyName}` }));
  await view.findByRole('header', { name: REGISTER.token.name });
  for (const kind of ['award', 'vesting'] as const) {
    const open = await view.findByRole('button', { name: kind === 'award' ? COPY.PREPARE : 'Record vesting' });
    await waitFor(() => expect(open).not.toBeDisabled());
    await fireEvent.press(open);
    if (kind === 'award') {
      for (const [label, value] of [
        ['Name', AWARD_REQUEST.name!],
        ['Residential address', AWARD_REQUEST.residentialAddress!],
        [COPY.SHARES, AWARD_REQUEST.shares],
        [COPY.TERMS_ON, AWARD_REQUEST.termsOn],
        [COPY.TERMS, AWARD_REQUEST.terms],
        [COPY.SCHEDULE, AWARD_REQUEST.schedule],
      ])
        await fireEvent.changeText(await view.findByLabelText(label), value);
    } else await fireEvent.changeText(await view.findByLabelText(COPY.VESTING_SHARES), '100');
    const noun = kind === 'award' ? 'agreement document' : 'vesting evidence';
    await fireEvent.press(view.getByRole('button', { name: `Choose the ${noun}` }));
    await view.findByRole('button', { name: `Replace the ${noun}` });
    const action = kind === 'award' ? COPY.SUBMIT : 'Record vesting';
    const close = kind === 'award' ? 'Close award form' : 'Close vesting form';
    const url = kind === 'award' ? URLS.REGISTER_AWARDS : URLS.REGISTER_AWARD_VESTINGS;
    await fireEvent.press(view.getByRole('button', { name: action }));
    await view.findByRole('alert');
    const original = submissions(url)[0];
    expect(view.getByRole('button', { name: close })).toBeDisabled();
    if (kind === 'award') await fireEvent.press(view.getByRole('button', { name: 'Refresh awards' }));
    else
      await act(async () => client.refetchQueries({ queryKey: awardVestingsKey(getSessionEpoch(), awards[0].uuid) }));
    await view.findByText(
      kind === 'award' ? /Employee awards could not be read/ : /vesting events could not be loaded/,
    );
    expect(view.queryByRole('button', { name: action })).toBeNull();
    if (kind === 'vesting') {
      failedPreferences = true;
      await act(async () => {
        await client
          .fetchQuery({
            queryKey: USER_PREFERENCES_QUERY_KEY,
            queryFn: async () => {
              throw new Error('Synthetic preferences unavailable');
            },
            retry: false,
          })
          .catch(() => {});
      });
      listed = false;
      await act(async () => client.refetchQueries({ queryKey: [...registerKey(getSessionEpoch()), 'classes'] }));
      await waitFor(() => expect(view.queryByText(AWARD_REQUEST.name!)).toBeNull());
      expect(view.queryByRole('button', { name: /^Download/ })).toBeNull();
    }
    appointments = [{ ...APPOINTMENT, capabilities: ['read_register'] }];
    failedRead = null;
    failedPreferences = false;
    listed = true;
    if (kind === 'vesting') await fireEvent.press(view.getByRole('button', { name: 'Retry register' }));
    const refresh = await view.findByRole('button', { name: /^(Retry|Refresh) awards$/ });
    await waitFor(() => expect(refresh).not.toBeDisabled());
    await fireEvent.press(refresh);
    await waitFor(() => expect(view.getByRole('button', { name: 'Refresh awards' })).not.toBeDisabled());
    if (kind === 'vesting') {
      await view.findByText(AWARD_REQUEST.name!);
      const retry = view.queryByRole('button', { name: 'Retry vesting events' });
      if (retry) await fireEvent.press(retry);
    }
    await waitFor(() => expect(view.getByRole('button', { name: action })).not.toBeDisabled());
    await fireEvent.press(view.getByRole('button', { name: action }));
    await waitFor(() => expect(view.queryByRole('button', { name: close })).toBeNull());
    expect(submissions(url)).toEqual([original]);
    expect(original).toEqual(expect.objectContaining({ appointment: APPOINTMENT.uuid }));
    expect(submissions(URLS.REGISTER_EVIDENCE)).toHaveLength(kind === 'award' ? 1 : 2);
    appointments = [APPOINTMENT];
    await fireEvent.press(view.getByRole('button', { name: 'Refresh awards' }));
  }
  expect(awards[0]).toEqual(
    expect.objectContaining({ vestedShares: '100', issuedShares: '0', availableShares: '100' }),
  );
  await fireEvent.press(await view.findByRole('button', { name: `Issue vested shares for ${AWARD_REQUEST.name}` }));
  await view.findByTestId('prepare-grant-screen');
  await view.findByText(AWARD_REQUEST.name!);
  expect(view.queryByLabelText('Name')).toBeNull();
  expect(view.getByLabelText('Company issue date (YYYY-MM-DD)')).toHaveDisplayValue('');
  for (const [label, value] of [
    [GRANT_COPY.SHARES, '100'],
    [GRANT_COPY.DIRECTOR, 'Synthetic Director'],
    [GRANT_COPY.AUTHORITY_REFERENCE, 'Company decision A'],
    [GRANT_COPY.REASON, 'Vested employee shares'],
  ])
    await fireEvent.changeText(view.getByLabelText(label), value);
  expect(view.queryByRole('button', { name: 'Choose the terms document' })).toBeNull();
  expect(view.getByText('The retained award agreement will be used for this issue.')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Choose the authority document' }));
  await view.findByRole('button', { name: 'Replace the authority document' });
  expect(view.getByRole('button', { name: 'Prepare share issue' })).toBeDisabled();
  await fireEvent.changeText(view.getByLabelText('Company issue date (YYYY-MM-DD)'), '2999-01-01');
  expect(view.getByRole('button', { name: 'Prepare share issue' })).toBeDisabled();
  await fireEvent.changeText(view.getByLabelText('Company issue date (YYYY-MM-DD)'), '2026-10-10');
  await fireEvent.press(view.getByRole('button', { name: 'Prepare share issue' }));
  await view.findByRole('alert');
  const originalGrant = submissions(URLS.REGISTER_GRANTS)[0];
  expect(originalGrant).toEqual(
    expect.objectContaining({
      appointment: APPOINTMENT.uuid,
      tokenId: REGISTER.token.uuid,
      award: awards[0].uuid,
      member: awards[0].member,
      companyEventOn: '2026-10-10',
      termsEvidence: awards[0].agreementEvidence,
    }),
  );
  listed = false;
  await act(async () => client.refetchQueries({ queryKey: [...registerKey(getSessionEpoch()), 'classes'] }));
  await waitFor(() =>
    expect(client.getQueryData([...registerKey(getSessionEpoch()), 'classes'])).toEqual([OTHER_COMPANY]),
  );
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  expect(submissions(URLS.REGISTER_GRANTS)).toEqual([originalGrant]);
  failedPreferences = true;
  await act(async () => {
    await client
      .fetchQuery({
        queryKey: USER_PREFERENCES_QUERY_KEY,
        queryFn: async () => {
          throw new Error('Synthetic preferences unavailable');
        },
        retry: false,
      })
      .catch(() => {});
  });
  await view.findByRole('button', { name: 'Refresh share issue' });
  expect(view.queryByLabelText(GRANT_COPY.SHARES)).toBeNull();
  expect(view.queryByRole('button', { name: 'Retry original share issue' })).toBeNull();
  failedPreferences = false;
  listed = true;
  appointments = [{ ...APPOINTMENT, capabilities: ['read_register'] }];
  await fireEvent.press(view.getByRole('button', { name: 'Refresh share issue' }));
  await fireEvent.press(await view.findByRole('button', { name: 'Retry original share issue' }));
  await view.findByRole('alert');
  expect(submissions(URLS.REGISTER_GRANTS)).toEqual([originalGrant]);
  expect(view.getByLabelText(GRANT_COPY.SHARES).props.editable).toBe(false);
  expect(view.getByLabelText('Company issue date (YYYY-MM-DD)')).toHaveProp('editable', false);
  expect(view.getByLabelText('Company issue date (YYYY-MM-DD)')).toHaveDisplayValue('2026-10-10');
  expect(client.getQueryData([...registerKey(getSessionEpoch()), 'classes'])).toEqual([OTHER_COMPANY]);
  failedRead = null;
  const retainedAward = awards[0];
  const retainedReceipt = grants[0];
  awards = [{ ...retainedAward, agreementEvidence: 'changed-agreement', agreementFingerprint: 'd'.repeat(64) }];
  grants = [{ ...retainedReceipt, termsFingerprint: 'c'.repeat(64) }];
  await act(async () =>
    client.refetchQueries({
      queryKey: [...awardsKey(getSessionEpoch(), REGISTER.token.uuid), retainedAward.uuid],
      exact: true,
    }),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Retry original share issue' }));
  await view.findByRole('alert');
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  expect(submissions(URLS.REGISTER_GRANTS)).toEqual([originalGrant]);
  grants = [retainedReceipt];
  failedClasses = true;
  await fireEvent.press(view.getByRole('button', { name: 'Retry original share issue' }));
  await waitFor(() =>
    expect(client.getQueryState([...registerKey(getSessionEpoch()), 'classes'])?.status).toBe('error'),
  );
  await waitFor(() => expect(view.getByRole('button', { name: 'Retry original share issue' })).not.toBeDisabled());
  await view.findByText('The preparation is confirmed. Refresh the company list before returning.');
  expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  expect(view.getByLabelText(GRANT_COPY.SHARES).props.editable).toBe(false);
  expect(submissions(URLS.REGISTER_GRANTS)).toEqual([originalGrant]);
  expect(submissions(URLS.REGISTER_EVIDENCE)).toHaveLength(3);
  awards = [retainedAward];
  failedClasses = false;
  await fireEvent.press(view.getByRole('button', { name: 'Retry original share issue' }));
  await waitFor(() => expect(view.queryByTestId('prepare-grant-screen')).toBeNull());
  expect(client.getQueryData([...registerKey(getSessionEpoch()), 'classes'])).toEqual([
    expect.objectContaining({ uuid: REGISTER.token.uuid, companyUuid: APPOINTMENT.company }),
    OTHER_COMPANY,
  ]);
  expect(mockNavigation.dispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'POP_TO',
      payload: {
        name: 'CompanyMain',
        params: {
          section: 'issue',
          companyUuid: APPOINTMENT.company,
          tokenUuid: REGISTER.token.uuid,
        },
      },
    }),
  );
  expect(
    view.getByRole('button', { name: `Select company ${APPOINTMENT.companyName}` }).props.accessibilityState.selected,
  ).toBe(true);
  expect(view.queryByRole('header', { name: OTHER_COMPANY.name })).toBeNull();
  await view.findByRole('header', { name: AWARD_REQUEST.name });
  expect(submissions(URLS.REGISTER_GRANTS)).toEqual([originalGrant]);
  expect(submissions(URLS.REGISTER_EVIDENCE)).toHaveLength(3);
  expect(view.queryByRole('button', { name: /^Approve the non-paid grant/ })).toBeNull();
  appointments = [APPOINTMENT];
  const datedGrant = grants[0];
  grants = [{ ...datedGrant, companyEventOn: null }];
  await waitFor(() => expect(view.getByRole('button', { name: 'Refresh share issues' })).not.toBeDisabled());
  await fireEvent.press(view.getByRole('button', { name: 'Refresh share issues' }));
  await view.findByText('Not recorded');
  await fireEvent.press(await view.findByRole('button', { name: `Details and documents for ${AWARD_REQUEST.name}` }));
  expect(view.getAllByText('Not recorded').length).toBeGreaterThan(0);
  expect(view.queryByRole('button', { name: /^Approve the non-paid grant/ })).toBeNull();
  expect(view.queryByRole('button', { name: /^Record issue the non-paid grant/ })).toBeNull();
  expect(view.getByRole('button', { name: /^Reject the non-paid grant/ })).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: `Details and documents for ${AWARD_REQUEST.name}` }));
  grants = [datedGrant];
  await waitFor(() => expect(view.getByRole('button', { name: 'Refresh share issues' })).not.toBeDisabled());
  await fireEvent.press(view.getByRole('button', { name: 'Refresh share issues' }));
  for (const kind of ['approve', 'apply'] as const) {
    const decision = await view.findByRole('button', {
      name: new RegExp(`^${kind === 'apply' ? 'Record issue' : 'Approve'} the non-paid grant`),
    });
    await waitFor(() => expect(decision).not.toBeDisabled());
    await fireEvent.press(decision);
    const confirm = await view.findByRole('button', { name: 'Confirm' });
    await waitFor(() => expect(confirm).not.toBeDisabled());
    expect(view.getAllByText('Company issue date').length).toBeGreaterThan(1);
    expect(view.getAllByText('10 October 2026').length).toBeGreaterThan(1);
    await fireEvent.press(confirm);
    await waitFor(() => expect(grants[0].decisions).toHaveLength(kind === 'approve' ? 1 : 2));
    if (kind === 'approve') {
      expect(grants[0].registerEntry).toBeNull();
      expect(awards[0].issuedShares).toBe('0');
      await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
    } else {
      const url = URLS.REGISTER_GRANT_DECIDE(grants[0].uuid);
      const original = submissions(url)[1];
      await view.findByRole('button', { name: /^Recover record issue receipt/ });
      await fireEvent.press(view.getByRole('button', { name: 'Refresh share issues' }));
      await view.findByText(/Non-paid issues could not be loaded/);
      expect(view.queryByRole('header', { name: AWARD_REQUEST.name })).toBeNull();
      failedRead = null;
      appointments = [{ ...APPOINTMENT, capabilities: ['read_register'] }];
      await fireEvent.press(view.getByRole('button', { name: 'Refresh share issues' }));
      await fireEvent.press(await view.findByRole('button', { name: /^Recover record issue receipt/ }));
      await waitFor(() => expect(view.queryByRole('button', { name: /^Recover record issue receipt/ })).toBeNull());
      expect(submissions(url)).toEqual([submissions(url)[0], original, original]);
      expect(grants[0].decisions).toHaveLength(2);
    }
  }
  await waitFor(() =>
    expect(client.getQueryState(awardsKey(getSessionEpoch(), REGISTER.token.uuid))).toEqual(
      expect.objectContaining({ status: 'success', data: [expect.objectContaining({ issuedShares: '100' })] }),
    ),
  );
  await act(() => mockSetParams({ section: 'awards' }));
  await view.findByText(/100 awarded\s*·\s*100 vested\s*·\s*100 issued/);
  expect(awards[0].availableShares).toBe('0');
  expect(grants[0].registerEntry).toBe('entry-a');
  expect(view.queryByRole('button', { name: /^Issue vested shares/ })).toBeNull();
});

it('refuses late vesting bytes after the vesting read fails and hides cached private rows after current authority is lost', async () => {
  awards = [
    {
      ...awardFrom({ ...AWARD_REQUEST, shares: '200' }),
      vestedShares: '100',
      availableShares: '100',
      unvestedRemainingShares: '100',
    },
  ];
  events = [
    vestingFrom({
      operationId: 'vesting-a',
      appointment: APPOINTMENT.uuid,
      award: awards[0].uuid,
      shares: '100',
      vestedOn: '2026-10-07',
      evidence: 'evidence-a',
    }),
  ];
  const view = await render(
    <ClassAwards
      company={APPOINTMENT.company}
      register={REGISTER}
      epoch={getSessionEpoch()}
      sourceReady
      onPrepareGrant={jest.fn()}
    />,
    { wrapper },
  );
  await view.findByText(AWARD_REQUEST.name!);
  await fireEvent.press(view.getByRole('button', { name: `Award records for ${AWARD_REQUEST.name}` }));
  const write = post.getMockImplementation()!;
  post.mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_AWARD_ENDS) {
      ends = [endFrom(body as RegisterAwardEndPreparation)];
      awards = [
        {
          ...awards[0],
          endedUnvestedShares: '20',
          endedVestedShares: '20',
          availableShares: '80',
          unvestedRemainingShares: '80',
          remainingUnissuedShares: '160',
        },
      ];
      throw new Error('End receipt interrupted');
    }
    if (url === URLS.REGISTER_AWARD_VESTING_REVERSALS) {
      reversals = [vestingReversalFrom(body as RegisterAwardVestingReversalPreparation, awards[0].uuid)];
      awards = [{ ...awards[0], vestedShares: '90', availableShares: '70', unvestedRemainingShares: '90' }];
      return { data: { ...reversals[0], reversedShares: '11' } };
    }
    return write(url, body);
  });
  const end = await view.findByRole('button', { name: COPY.END });
  await waitFor(() => expect(end).not.toBeDisabled());
  await fireEvent.press(end);
  expect(view.getByLabelText(COPY.COMPANY_EVENT_ON)).toHaveDisplayValue('');
  for (const [label, value] of [
    [COPY.END_UNVESTED, '20'],
    [COPY.END_VESTED, '20'],
    [COPY.REASON, 'Company ends selected unissued rights'],
    [COPY.COMPANY_EVENT_ON, '2026-10-12'],
  ])
    await fireEvent.changeText(view.getByLabelText(label), value);
  await fireEvent.press(view.getByRole('button', { name: 'Choose the supporting evidence' }));
  await view.findByRole('button', { name: 'Replace the supporting evidence' });
  await fireEvent.press(view.getByRole('button', { name: COPY.END }));
  await view.findByRole('alert');
  const originalEnd = submissions(URLS.REGISTER_AWARD_ENDS)[0];
  expect(originalEnd).toEqual(
    expect.objectContaining({
      award: awards[0].uuid,
      unvestedShares: '20',
      vestedShares: '20',
      companyEventOn: '2026-10-12',
    }),
  );
  failedRead = 'change';
  await act(async () => client.refetchQueries({ queryKey: awardEndsKey(getSessionEpoch(), awards[0].uuid) }));
  await view.findByText('Entitlement changes could not be loaded.');
  expect(view.queryByLabelText(COPY.COMPANY_EVENT_ON)).toBeNull();
  appointments = [{ ...APPOINTMENT, capabilities: ['read_register'] }];
  failedRead = null;
  await fireEvent.press(view.getByRole('button', { name: 'Refresh awards' }));
  await fireEvent.press(await view.findByRole('button', { name: 'Retry entitlement changes' }));
  const recoverEnd = await view.findByRole('button', { name: COPY.END });
  await waitFor(() => expect(recoverEnd).not.toBeDisabled());
  expect(view.getByLabelText(COPY.END_VESTED)).toHaveProp('editable', false);
  mismatchedEndReceipt = true;
  await fireEvent.press(recoverEnd);
  await waitFor(() => expect(view.getByRole('button', { name: COPY.END })).not.toBeDisabled());
  expect(view.getByRole('alert')).toBeTruthy();
  expect(submissions(URLS.REGISTER_AWARD_ENDS)).toEqual([originalEnd]);
  expect(view.getByLabelText(COPY.END_VESTED)).toHaveProp('editable', false);
  mismatchedEndReceipt = false;
  await fireEvent.press(view.getByRole('button', { name: COPY.END }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Close change form' })).toBeNull());
  expect(submissions(URLS.REGISTER_AWARD_ENDS)).toEqual([originalEnd]);
  appointments = [APPOINTMENT];
  await fireEvent.press(view.getByRole('button', { name: 'Refresh awards' }));
  const reverse = await view.findByRole('button', { name: 'Correct vesting 100 shares dated 2026-10-07' });
  await waitFor(() => expect(reverse).not.toBeDisabled());
  await fireEvent.press(reverse);
  for (const [label, value] of [
    [COPY.REVERSED_SHARES, '10'],
    [COPY.REASON, 'Correct recorded vesting'],
    [COPY.COMPANY_EVENT_ON, '2026-10-13'],
  ])
    await fireEvent.changeText(view.getByLabelText(label), value);
  await fireEvent.press(view.getByRole('button', { name: 'Choose the supporting evidence' }));
  await view.findByRole('button', { name: 'Replace the supporting evidence' });
  await fireEvent.press(view.getByRole('button', { name: COPY.REVERSE }));
  await view.findByRole('alert');
  const originalReversal = submissions(URLS.REGISTER_AWARD_VESTING_REVERSALS)[0];
  expect(originalReversal).toEqual(expect.objectContaining({ vesting: events[0].uuid, reversedShares: '10' }));
  await fireEvent.press(view.getByRole('button', { name: COPY.REVERSE }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Close change form' })).toBeNull());
  expect(submissions(URLS.REGISTER_AWARD_VESTING_REVERSALS)).toEqual([originalReversal]);
  expect(awards[0]).toEqual(
    expect.objectContaining({
      shares: '200',
      vestedShares: '90',
      issuedShares: '0',
      availableShares: '70',
      endedUnvestedShares: '20',
      endedVestedShares: '20',
      remainingUnissuedShares: '160',
    }),
  );
  expect(events[0].shares).toBe('100');
  await fireEvent.press(await view.findByRole('button', { name: /^Download vesting evidence/ }));
  await waitFor(() => expect(pendingFileRelease).toBeDefined());
  failedRead = 'vesting';
  await act(async () => client.refetchQueries({ queryKey: awardVestingsKey(getSessionEpoch(), awards[0].uuid) }));
  await view.findByText(/vesting events could not be loaded/);
  await act(async () => pendingFileRelease!());
  pendingFileRelease = undefined;
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(files.size).toBe(0);
  failedRead = null;
  await fireEvent.press(view.getByRole('button', { name: 'Retry vesting events' }));
  await view.findByRole('button', { name: /^Download vesting evidence/ });
  appointments = [{ ...APPOINTMENT, capabilities: ['finance'] }];
  await fireEvent.press(view.getByRole('button', { name: 'Refresh awards' }));
  await waitFor(() => expect(view.queryByText(AWARD_REQUEST.name!)).toBeNull());
  expect(view.queryByRole('button', { name: /^Download/ })).toBeNull();
  expect(view.queryByRole('button', { name: COPY.PREPARE })).toBeNull();
});

import React from 'react';
import { ApiClientProvider, AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  formatDateTime,
  REGISTER_CORRECTION_COPY,
  REGISTER_IMPORT_COPY,
  REGISTER_OPENING_COPY as COPY,
  REGISTER_OPENING_UNMET_COPY,
  REGISTER_RECONCILIATION_COPY,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { cache, resetFiles } from '../../testSupport/documentFiles';
import { CompanyRegisterScreen } from './CompanyRegisterScreen';
import { openingsKey } from './useCompanyRegister';

const mockNavigate = jest.fn();
const mockPreferences = { userAccount: { role: 'company' }, isLoading: false, isError: false, refetch: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => mockPreferences,
}));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));

type Kind = 'approve' | 'apply' | 'reject';
type Params = { page?: number; token?: string };
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const ENTRIES_URL = URLS.REGISTER_ENTRIES('ordinary');
const DIGEST = 'a'.repeat(64);
const ADA = '0xAdA0000000000000000000000000000000000a01';
const BEA = '0xBea0000000000000000000000000000000000b02';
const CY = '0xC000000000000000000000000000000000000c03';
const DEE = '0xDee0000000000000000000000000000000000d04';
const MEMBER_A = '10000000-0000-4000-8000-0000000000aa';
const FRESH_X = '20000000-0000-4000-8000-0000000000aa';
const FRESH_Y = '20000000-0000-4000-8000-0000000000bb';
const prepared = (createdAt: string) => `prepared on ${formatDateTime(createdAt)}`;
const NEW = `prepared opening at block 1234, ${prepared('2026-10-05T01:00:00Z')}`;
const STAFF_ERA = `prepared opening with no boundary captured, ${prepared('2026-10-02T01:00:00Z')}`;
const REJECTED_ONE = `rejected opening at block 1200, ${prepared('2026-10-04T01:00:00Z')}`;
const NEW_HEADING = `Prepared · ${COPY.BOUNDARY_BLOCK(1234, '4 October 2026')}`;
const REJECTED_HEADING = `Rejected · ${COPY.BOUNDARY_BLOCK(1200, '3 October 2026')}`;
const STAFF_HEADING = 'Prepared · No boundary captured';
const FAILED = 'The openings could not be loaded.';
const OPEN = `${COPY.PREPARE} for Ordinary shares`;
const KEY = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const step = (kind: string, description = NEW) => `${kind} the ${description}`;
const text = (element: { props: { children?: unknown } }) => [element.props.children].flat().join('');
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const shareClass = {
  uuid: 'ordinary',
  name: 'Ordinary shares',
  symbol: 'ORD',
  companyUuid: 'paper',
  companyName: 'Paper Company',
};
const unopened = {
  token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'deployed', totalSupply: '1000' },
  issuedSupply: null as string | null,
  initialized: false,
  waitingEffects: null as number | null,
  totalHolders: 0,
  holders: [] as unknown[],
};
const opened = {
  ...unopened,
  issuedSupply: '100',
  initialized: true,
  waitingEffects: 0,
  totalHolders: 1,
  holders: [
    {
      member: MEMBER_A,
      name: 'Alex Member',
      holderType: 'member',
      balance: '100',
      enteredOn: '2026-10-04',
      wallets: [],
    },
  ],
};
const OPENING_ENTRY = {
  uuid: 'entry-1',
  sequence: 1,
  kind: 'opening',
  effectiveOn: '2026-10-04',
  recordedAt: '2026-10-05T05:00:00Z',
  changes: [{ member: MEMBER_A, name: 'Alex Member', shares: '100' }],
  corrects: null,
  correctedBy: null,
  correctable: true,
};
const holding = (
  address: string,
  shares: string,
  member: string | null,
  memberName: string | null = null,
  memberExists = memberName !== null,
) => ({ address, shares, member, memberName, memberExists });
const OPENING = {
  uuid: 'opening-new',
  company: 'paper',
  token: 'ordinary',
  mapping: [
    { address: ADA, member: MEMBER_A },
    { address: BEA, member: FRESH_X },
    { address: CY, member: FRESH_Y },
    { address: DEE, member: FRESH_X },
  ],
  boundary: {},
  boundarySummary: {
    blockNumber: 1234,
    blockHash: `0x${'c'.repeat(64)}`,
    date: '2026-10-04',
    holdings: [
      holding(ADA, '9007199254740993', MEMBER_A, 'Alex Member'),
      holding(BEA, '40', FRESH_X),
      holding(CY, '1', FRESH_Y),
      holding(DEE, '7', FRESH_X),
    ],
  } as {
    blockNumber: number;
    blockHash: string;
    date: string;
    holdings: ReturnType<typeof holding>[];
  } | null,
  authority: 'director_resolution',
  approvingDirector: 'Dana Director',
  authorityReference: 'RESOLUTION-9',
  reason: 'Open the register from the chain',
  sourceDocument: null as string | null,
  evidenceFingerprint: 'd'.repeat(64),
  evidenceSnapshot: { providedBy: 'company' },
  authorityEvidence: 'evidence-authority' as string | null,
  preparingAppointment: 'appointment-prepare' as string | null,
  preparedByName: 'Pat Preparer' as string | null,
  providedBy: 'company',
  submittedBy: 1,
  status: 'submitted',
  stage: 'submitted',
  reviewedBy: null,
  reviewedAt: null as string | null,
  rejectionReason: '',
  appliedEntry: null as string | null,
  decisions: [] as unknown[],
  createdAt: '2026-10-05T01:00:00Z',
};

function decision(
  kind: Kind,
  key: string,
  { appointment = 'appointment-admin', reason = '', name = 'Ari Admin' } = {},
) {
  return {
    uuid: `decision-${key}`,
    kind,
    appointment,
    idempotencyKey: key,
    digest: DIGEST,
    reason,
    decidedAt: '2026-10-04T03:00:00Z',
    decidedBy: 1,
    decidedByName: name,
  };
}

const REJECTED = {
  ...OPENING,
  uuid: 'opening-rejected',
  boundarySummary: {
    blockNumber: 1200,
    blockHash: `0x${'b'.repeat(64)}`,
    date: '2026-10-03',
    holdings: [holding(ADA, '100', MEMBER_A, 'Alex Member')],
  },
  authority: 'court_order',
  approvingDirector: '',
  authorityReference: 'COURT-4',
  reason: 'Open the register under the court order',
  preparedByName: 'Casey Preparer',
  status: 'rejected',
  stage: 'rejected',
  reviewedAt: '2026-10-04T03:00:00Z',
  rejectionReason: 'The holdings moved',
  decisions: [
    { ...decision('approve', 'key-approved', { name: 'Robin Approver' }), decidedAt: '2026-10-04T02:00:00Z' },
    decision('reject', 'key-rejected', { reason: 'The holdings moved' }),
  ],
  createdAt: '2026-10-04T01:00:00Z',
};
const STAFF = {
  ...OPENING,
  uuid: 'opening-staff',
  boundarySummary: null,
  authorityReference: 'STAFF-RESOLUTION-2',
  approvingDirector: 'Sam Director',
  reason: 'Open the staff-era register',
  providedBy: 'staff_verified',
  preparedByName: null,
  preparingAppointment: null,
  authorityEvidence: null,
  sourceDocument: 'document-1',
  createdAt: '2026-10-02T01:00:00Z',
};
const PREVIEW = {
  previewDigest: DIGEST,
  unmetRequirements: [] as string[],
  canDecide: true,
  effectiveOn: '2026-10-04' as string | null,
  changes: [
    { member: FRESH_X, shares: '47' },
    { member: MEMBER_A, shares: '9007199254740993' },
    { member: FRESH_Y, shares: '1' },
  ],
};
const UNREASONED = { ...PREVIEW, canDecide: false, unmetRequirements: ['reason_required'] };
const PDF = { data: new Uint8Array([37, 80, 68, 70]).buffer, headers: { 'content-type': 'application/pdf' } };
let client: QueryClient;
let register: typeof unopened;
let entries: unknown[];
let openingPages: unknown[][];
let openingAnswers: Map<number, () => Promise<unknown>>;
let appointments: unknown[];
let failing: Set<string>;
let held: Set<string>;

function appointment(uuid: string, capabilities: string[], changes: object = {}) {
  return {
    uuid,
    company: 'paper',
    companyName: 'Paper Company',
    capabilities,
    delegatableCapabilities: [],
    createdAt: '2026-10-01T00:00:00Z',
    declarationText: null,
    declarationVersion: null,
    expiresAt: null,
    isEffective: true,
    revokedAt: null,
    source: 'invitation',
    status: 'active',
    ...changes,
  };
}

const revoked = (uuid: string, capabilities: string[]) =>
  appointment(uuid, capabilities, { isEffective: false, status: 'revoked', revokedAt: '2026-10-05T00:00:00Z' });

function decided(kind: Kind, key: string, { appointment = 'appointment-admin', reason = '' } = {}) {
  const recorded = { ...decision(kind, key, { appointment, reason }), decidedAt: '2026-10-05T05:00:00Z' };
  return {
    ...OPENING,
    status: kind === 'approve' ? 'submitted' : kind === 'apply' ? 'applied' : 'rejected',
    stage: kind === 'approve' ? 'approved' : kind === 'apply' ? 'applied' : 'rejected',
    reviewedAt: kind === 'approve' ? null : recorded.decidedAt,
    rejectionReason: kind === 'reject' ? reason : '',
    appliedEntry: kind === 'apply' ? 'entry-1' : null,
    decisions: [recorded],
  };
}

const page = (results: unknown[], next: string | null = null) => ({ data: { results, next, count: results.length } });
const paged = (pages: unknown[][], number: number) =>
  page(pages[number - 1] ?? [], number < pages.length ? `https://api.example.test/?page=${number + 1}` : null);
const reads = (url: string) => get.mock.calls.filter(([called]) => called === url).length;
const requests = (url: string) =>
  get.mock.calls
    .filter(([called]) => called === url)
    .map(([, config]) => config as { params: Params; ledovaSessionEpoch: number; signal: AbortSignal });
const refreshed = () => [
  reads(URLS.REGISTER_OPENINGS),
  reads(ENTRIES_URL),
  reads(URLS.HOLDERS('ordinary')),
  reads(APPOINTMENTS),
];
const headings = (view: Awaited<ReturnType<typeof render>>) =>
  view.getAllByText(/^(Prepared|Approved|Applied|Rejected) · /).map(text);
const section = (view: Awaited<ReturnType<typeof render>>) => within(view.getByText(COPY.TITLE).parent!);
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

async function openClass() {
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  await view.findByText(NEW_HEADING);
  return view;
}

beforeEach(() => {
  resetFiles();
  register = unopened;
  entries = [];
  openingPages = [[STAFF, OPENING], [REJECTED]];
  openingAnswers = new Map();
  appointments = [appointment('appointment-admin', ['admin'])];
  failing = new Set();
  held = new Set();
  let keys = 0;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => KEY(++keys) as ReturnType<typeof Crypto.randomUUID>);
  mockNavigate.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
  });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } },
  });
  post.mockReset();
  get.mockReset().mockImplementation(async (url, config) => {
    const params = (config?.params ?? {}) as Params;
    const number = params.page ?? 1;
    if (held.has(url)) return new Promise(() => {}) as ReturnType<typeof get>;
    if (failing.has(url)) throw new Error('Unavailable');
    if (url === URLS.REGISTER) return page([shareClass]);
    if (url === URLS.HOLDERS('ordinary')) return { data: register };
    if (url === URLS.REGISTER_IMPORTS || url === URLS.REGISTER_CORRECTIONS || url === URLS.REGISTER_RECONCILIATIONS)
      return page([]);
    if (url === APPOINTMENTS) return page(appointments);
    if (url === ENTRIES_URL) return page(entries);
    if (url === URLS.REGISTER_OPENINGS)
      return params.token === 'ordinary' ? (openingAnswers.get(number)?.() ?? paged(openingPages, number)) : page([]);
    if (url === URLS.REGISTER_OPENING_FILE('opening-new')) return PDF;
    throw new Error(`Unexpected ${url}`);
  });
  jest.mocked(Sharing.shareAsync).mockClear();
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

it('reads every page of the class openings by its share class and shows each newest first with its holdings', async () => {
  appointments = [appointment('appointment-reader', ['read_register'])];
  const view = await openClass();
  const epoch = getSessionEpoch();
  const session = { ledovaSessionEpoch: epoch, signal: expect.objectContaining({ aborted: false }) };
  expect(requests(URLS.REGISTER_OPENINGS)).toEqual([
    { ...session, params: { token: 'ordinary', page: 1 } },
    { ...session, params: { token: 'ordinary', page: 2 } },
  ]);
  expect(headings(view)).toEqual([NEW_HEADING, REJECTED_HEADING, STAFF_HEADING]);
  expect(view.getByText(COPY.BOUNDARY_NOTE)).toBeTruthy();
  expect(view.getAllByText(COPY.PROVIDED_BY_COMPANY)).toHaveLength(2);
  expect(view.getByText(COPY.STAFF_VERIFIED)).toBeTruthy();
  expect(view.queryByText(/verified by Ledova(?! staff before)/i)).toBeNull();
  const record = within(view.getByText(NEW_HEADING).parent!);
  expect(record.getByText('Pat Preparer')).toBeTruthy();
  expect(record.getByText(formatDateTime(OPENING.createdAt))).toBeTruthy();
  expect(record.getByText(COPY.AUTHORITIES.director_resolution)).toBeTruthy();
  expect(record.getByText('Dana Director')).toBeTruthy();
  expect(record.getByText('RESOLUTION-9')).toBeTruthy();
  expect(record.getByText('Open the register from the chain')).toBeTruthy();
  expect(record.getAllByText(/ · \d[\d,]* shares?$/).map(text)).toEqual([
    'Alex Member · 9,007,199,254,740,993 shares',
    `${COPY.NEW_MEMBER_NUMBERED(1)} · 40 shares`,
    `${COPY.NEW_MEMBER_NUMBERED(1)} · 7 shares`,
    `${COPY.NEW_MEMBER_NUMBERED(2)} · 1 share`,
  ]);
  expect(record.getAllByText(/^0x/).map(text)).toEqual([ADA, BEA, DEE, CY]);
  for (const address of [ADA, BEA, CY, DEE]) expect(record.getByText(address)).toBeTruthy();
  const rejected = within(view.getByText(REJECTED_HEADING).parent!);
  expect(rejected.getByText(COPY.AUTHORITIES.court_order)).toBeTruthy();
  expect(rejected.queryByText(COPY.APPROVING_DIRECTOR)).toBeNull();
  const trail = (label: string) => within(rejected.getByText(label).parent!);
  expect(
    trail(COPY.STAGES.approved).getByText(`Robin Approver · ${formatDateTime('2026-10-04T02:00:00Z')}`),
  ).toBeTruthy();
  expect(trail(COPY.STAGES.rejected).getByText(`Ari Admin · ${formatDateTime('2026-10-04T03:00:00Z')}`)).toBeTruthy();
  expect(rejected.getByText('The holdings moved')).toBeTruthy();
  expect(rejected.queryByText('Decided on')).toBeNull();
  const staff = within(view.getByText(STAFF_HEADING).parent!);
  expect(staff.getByText('No boundary was captured for this opening, so it lists no holdings.')).toBeTruthy();
  expect(staff.queryByText('Prepared by')).toBeNull();
  expect(view.getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(view.queryByRole('button', { name: OPEN })).toBeNull();
  for (const kind of ['Approve', 'Apply', 'Reject'])
    expect(view.queryByRole('button', { name: step(kind) })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: `${COPY.DOWNLOAD} of the ${NEW}` }));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(`${cache}ledova-document-views-v1/authority-opening-new.pdf`, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
    }),
  );
  expect(get).toHaveBeenCalledWith(URLS.REGISTER_OPENING_FILE('opening-new'), {
    responseType: 'arraybuffer',
    ledovaSessionEpoch: epoch,
  });
  await waitFor(() => expect(view.getByRole('button', { name: `${COPY.DOWNLOAD} of the ${NEW}` })).toBeEnabled());
  expect(view.getByRole('button', { name: `${COPY.DOWNLOAD} of the ${STAFF_ERA}` })).toBeTruthy();
  expect(view.getByRole('button', { name: `${COPY.DOWNLOAD} of the ${REJECTED_ONE}` })).toBeTruthy();
});

it('dates a decided staff-era opening that has no decision trail', async () => {
  openingPages = [[OPENING, { ...STAFF, status: 'rejected', stage: 'rejected', reviewedAt: '2026-10-03T05:00:00Z' }]];
  const view = await openClass();
  const staff = within(view.getByText('Rejected · No boundary captured').parent!);
  expect(staff.getByText('Decided on')).toBeTruthy();
  expect(staff.getByText(formatDateTime('2026-10-03T05:00:00Z'))).toBeTruthy();
});

it('lists the holdings largest first and numbers new members in that order, whatever order the summary gives', async () => {
  const low = '0xAAA0000000000000000000000000000000000a01';
  const high = '0xBBB0000000000000000000000000000000000b02';
  const summary = { ...OPENING.boundarySummary!, holdings: [holding(low, '5', FRESH_X), holding(high, '50', FRESH_Y)] };
  openingPages = [[{ ...OPENING, boundarySummary: summary }]];
  post.mockResolvedValueOnce({
    data: {
      ...PREVIEW,
      changes: [
        { member: FRESH_X, shares: '5' },
        { member: FRESH_Y, shares: '50' },
      ],
    },
  });
  const view = await openClass();
  const record = within(view.getByText(NEW_HEADING).parent!);
  expect(record.getAllByText(/ · \d[\d,]* shares?$/).map(text)).toEqual([
    `${COPY.NEW_MEMBER_NUMBERED(1)} · 50 shares`,
    `${COPY.NEW_MEMBER_NUMBERED(2)} · 5 shares`,
  ]);
  expect(record.getAllByText(/^0x/).map(text)).toEqual([high, low]);
  await fireEvent.press(view.getByRole('button', { name: step('Approve') }));
  await view.findByText(COPY.CONFIRMATIONS.approve);
  expect(view.getByText(`${COPY.NEW_MEMBER_NUMBERED(1)}: +50`)).toBeTruthy();
  expect(view.getByText(`${COPY.NEW_MEMBER_NUMBERED(2)}: +5`)).toBeTruthy();
});

it('names an existing member without a name as an unnamed member, numbered apart from the members the opening creates', async () => {
  const unnamed = ['10000000-0000-4000-8000-0000000000cc', '10000000-0000-4000-8000-0000000000dd'];
  const summary = {
    ...OPENING.boundarySummary!,
    holdings: [
      holding(ADA, '30', unnamed[0], null, true),
      holding(BEA, '20', FRESH_X),
      holding(CY, '10', unnamed[1], null, true),
      holding(DEE, '5', FRESH_Y),
    ],
  };
  openingPages = [[{ ...OPENING, boundarySummary: summary }]];
  const view = await openClass();
  expect(
    within(view.getByText(NEW_HEADING).parent!)
      .getAllByText(/ · \d[\d,]* shares?$/)
      .map(text),
  ).toEqual([
    `${COPY.UNNAMED_MEMBER_NUMBERED(1)} · 30 shares`,
    `${COPY.NEW_MEMBER_NUMBERED(1)} · 20 shares`,
    `${COPY.UNNAMED_MEMBER_NUMBERED(2)} · 10 shares`,
    `${COPY.NEW_MEMBER_NUMBERED(2)} · 5 shares`,
  ]);
});

it('names a preparer without a recorded name neutrally and a holding without a member neutrally', async () => {
  const summary = OPENING.boundarySummary!;
  openingPages = [
    [{ ...OPENING, preparedByName: '', boundarySummary: { ...summary, holdings: [holding(ADA, '5', null)] } }],
  ];
  const view = await openClass();
  const record = within(view.getByText(NEW_HEADING).parent!);
  expect(record.getByText('Name not recorded')).toBeTruthy();
  expect(record.getByText(`${COPY.MEMBER} · 5 shares`)).toBeTruthy();
});

it('says when no address held shares at the boundary of an opening', async () => {
  openingPages = [[{ ...OPENING, boundarySummary: { ...OPENING.boundarySummary!, holdings: [] } }]];
  const view = await openClass();
  expect(within(view.getByText(NEW_HEADING).parent!).getByText(COPY.NO_HOLDINGS)).toBeTruthy();
});

it('says a class without openings has none, and offers to open its register', async () => {
  openingPages = [[]];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText(COPY.EMPTY)).toBeTruthy();
  expect(await view.findByRole('button', { name: OPEN })).toBeTruthy();
});

it('lists an opening once when the next page repeats it after a newer opening was prepared', async () => {
  openingPages = [
    [OPENING, STAFF],
    [STAFF, REJECTED],
  ];
  const view = await openClass();
  expect(headings(view)).toEqual([NEW_HEADING, REJECTED_HEADING, STAFF_HEADING]);
  expect(view.getAllByRole('button', { name: step('Approve') })).toHaveLength(1);
});

it.each([
  ['another company', { company: 'garden' }],
  ['another share class', { token: 'preference' }],
])('refuses openings that name %s and retries them alone', async (_, foreign) => {
  openingPages = [[OPENING, { ...STAFF, ...foreign }]];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText(FAILED)).toBeTruthy();
  expect(view.queryByText(NEW_HEADING)).toBeNull();
  expect(view.queryByRole('button', { name: OPEN })).toBeNull();
  expect(await view.findByText(REGISTER_CORRECTION_COPY.ENTRIES_EMPTY)).toBeTruthy();
  openingPages = [[OPENING]];
  await fireEvent.press(view.getByRole('button', { name: 'Retry openings for Ordinary shares' }));
  expect(await view.findByText(NEW_HEADING)).toBeTruthy();
});

it('refuses an opening whose mapping cannot be read', async () => {
  openingPages = [[OPENING, { ...STAFF, mapping: [{ address: ADA }] }]];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText(FAILED)).toBeTruthy();
  expect(view.queryByText(NEW_HEADING)).toBeNull();
});

it('refuses openings that record a holding that is not whole, and retries them', async () => {
  const summary = { ...REJECTED.boundarySummary, holdings: [holding(ADA, '1.5', MEMBER_A, 'Alex Member')] };
  openingPages = [[OPENING, { ...REJECTED, boundarySummary: summary }]];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText(FAILED)).toBeTruthy();
  expect(view.queryByText(NEW_HEADING)).toBeNull();
  openingPages = [[OPENING, REJECTED]];
  await fireEvent.press(view.getByRole('button', { name: 'Retry openings for Ordinary shares' }));
  expect(await view.findByText(REJECTED_HEADING)).toBeTruthy();
});

it('hides the openings after a failed read and offers a retry', async () => {
  failing = new Set([URLS.REGISTER_OPENINGS]);
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText(FAILED)).toBeTruthy();
  expect(view.queryByRole('button', { name: OPEN })).toBeNull();
  failing = new Set();
  await fireEvent.press(view.getByRole('button', { name: 'Retry openings for Ordinary shares' }));
  expect(await view.findByText(NEW_HEADING)).toBeTruthy();
  expect(view.queryByText(FAILED)).toBeNull();
});

it.each(['draft', 'deploying'])('shows a %s class no openings and reads none', async (status) => {
  register = { ...unopened, token: { ...unopened.token, status } };
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText(REGISTER_IMPORT_COPY.EMPTY)).toBeTruthy();
  expect(view.queryByText(COPY.TITLE)).toBeNull();
  expect(view.queryByRole('button', { name: OPEN })).toBeNull();
  expect(reads(URLS.REGISTER_OPENINGS)).toBe(0);
});

it('lists the openings of a paused class', async () => {
  register = { ...unopened, token: { ...unopened.token, status: 'paused' } };
  const view = await openClass();
  expect(await view.findByRole('button', { name: OPEN })).toBeTruthy();
});

it.each([
  ['approval and rejection', ['approve'], ['Approve', 'Reject'], false],
  ['application', ['apply'], ['Apply'], false],
  ['preparation', ['prepare'], [], true],
  ['every step', ['admin'], ['Approve', 'Apply', 'Reject'], true],
])('offers %s only through an effective appointment holding it', async (_, capabilities, offered, opens) => {
  appointments = [appointment('appointment-step', capabilities)];
  const view = await openClass();
  for (const kind of ['Approve', 'Apply', 'Reject']) {
    expect(!!view.queryByRole('button', { name: step(kind) })).toBe(offered.includes(kind));
    expect(view.queryByRole('button', { name: step(kind, REJECTED_ONE) })).toBeNull();
  }
  expect(!!view.queryByRole('button', { name: OPEN })).toBe(opens);
  expect(view.queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
});

it.each([
  ['a register reader', [appointment('appointment-reader', ['read_register'])]],
  ['an expired administrator', [appointment('appointment-expired', ['admin'], { expiresAt: '2020-01-01T00:00:00Z' })]],
  ['another company administrator', [appointment('appointment-other', ['admin'], { company: 'garden' })]],
])('shows %s the openings read-only', async (_, own) => {
  appointments = own;
  const view = await openClass();
  expect(section(view).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  for (const kind of ['Approve', 'Apply', 'Reject'])
    expect(view.queryByRole('button', { name: step(kind) })).toBeNull();
  expect(view.queryByRole('button', { name: step('Reject', STAFF_ERA) })).toBeNull();
  expect(view.queryByRole('button', { name: OPEN })).toBeNull();
});

it('offers a retained staff-era opening only rejection, beside a company opening offering every step', async () => {
  const view = await openClass();
  expect(view.getByRole('button', { name: step('Reject', STAFF_ERA) })).toBeTruthy();
  expect(view.queryByRole('button', { name: step('Approve', STAFF_ERA) })).toBeNull();
  expect(view.queryByRole('button', { name: step('Apply', STAFF_ERA) })).toBeNull();
  for (const kind of ['Approve', 'Apply', 'Reject'])
    expect(view.getByRole('button', { name: step(kind) })).toBeTruthy();
});

it('names two openings at one block apart by when each was prepared, never by an ID or address', async () => {
  openingPages = [[OPENING, { ...OPENING, uuid: 'opening-again', createdAt: '2026-10-05T02:00:00Z' }]];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findAllByText(NEW_HEADING)).toHaveLength(2);
  const again = `prepared opening at block 1234, ${prepared('2026-10-05T02:00:00Z')}`;
  for (const description of [NEW, again]) {
    for (const kind of ['Approve', 'Apply', 'Reject'])
      expect(view.getByRole('button', { name: step(kind, description) })).toBeTruthy();
    expect(view.getByRole('button', { name: `${COPY.DOWNLOAD} of the ${description}` })).toBeTruthy();
  }
  const names = view
    .getAllByRole('button')
    .map((button) => String(button.props.accessibilityLabel ?? ''))
    .filter(Boolean);
  expect(names.filter((name) => /opening-|0x[0-9a-f]{6}|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name))).toEqual([]);
});

it('opens the opening page for an unopened class with its class and company', async () => {
  appointments = [appointment('appointment-prepare', ['prepare'])];
  const view = await openClass();
  await fireEvent.press(await view.findByRole('button', { name: OPEN }));
  expect(mockNavigate).toHaveBeenCalledWith('PrepareRegisterOpening', { tokenUuid: 'ordinary', companyUuid: 'paper' });
});

it('offers no opening of a class whose register is already opened', async () => {
  register = opened;
  const view = await openClass();
  expect(view.queryByRole('button', { name: OPEN })).toBeNull();
  expect(view.getByRole('button', { name: step('Approve') })).toBeTruthy();
});

it('withdraws every opening step once a pull to refresh reads the appointment as revoked', async () => {
  const view = await openClass();
  expect(view.getByRole('button', { name: step('Approve') })).toBeTruthy();
  appointments = [revoked('appointment-admin', ['admin'])];
  await act(() => view.getByTestId('register-screen').props.refreshControl.props.onRefresh());
  await waitFor(() => expect(view.queryByRole('button', { name: step('Approve') })).toBeNull());
  expect(view.queryByRole('button', { name: OPEN })).toBeNull();
  expect(view.queryByRole('button', { name: step('Reject', STAFF_ERA) })).toBeNull();
  expect(section(view).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('shows a newly prepared opening after a pull to refresh', async () => {
  const view = await openClass();
  openingPages = [[{ ...OPENING, uuid: 'opening-later', createdAt: '2026-10-05T09:00:00Z' }, OPENING], [REJECTED]];
  await act(() => view.getByTestId('register-screen').props.refreshControl.props.onRefresh());
  await waitFor(() => expect(view.getAllByText(NEW_HEADING)).toHaveLength(2));
  expect(headings(view)).toEqual([NEW_HEADING, NEW_HEADING, REJECTED_HEADING]);
});

it('previews an approval with the boundary note and the named first entry, records it and refreshes', async () => {
  post.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: decided('approve', KEY(1)) });
  const view = await openClass();
  const epoch = getSessionEpoch();
  const before = refreshed();
  await fireEvent.press(view.getByRole('button', { name: step('Approve') }));
  expect(await view.findByText(COPY.CONFIRMATIONS.approve)).toBeTruthy();
  expect(view.getByText('Approve opening')).toBeTruthy();
  expect(post).toHaveBeenCalledWith(
    URLS.REGISTER_OPENING_PREVIEW('opening-new'),
    { appointment: 'appointment-admin', kind: 'approve', reason: '' },
    { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: expect.any(Function) },
  );
  expect(view.getAllByText(COPY.BOUNDARY_NOTE)).toHaveLength(2);
  expect(view.queryByText(COPY.HOLDINGS_NOTE)).toBeNull();
  expect(within(view.getByText('Effective date').parent!).getByText('4 October 2026')).toBeTruthy();
  expect(view.getByText('The register’s first entry')).toBeTruthy();
  expect(view.getByText(`${COPY.NEW_MEMBER_NUMBERED(1)}: +47`)).toBeTruthy();
  expect(view.getByText('Alex Member: +9,007,199,254,740,993')).toBeTruthy();
  expect(view.getByText(`${COPY.NEW_MEMBER_NUMBERED(2)}: +1`)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_OPENING_DECIDE('opening-new'),
    {
      appointment: 'appointment-admin',
      kind: 'approve',
      reason: '',
      idempotencyKey: KEY(1),
      previewDigest: DIGEST,
      confirmation: true,
    },
    { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: expect.any(Function) },
  );
  await waitFor(() => refreshed().forEach((count, index) => expect(count).toBeGreaterThan(before[index])));
});

it('notes before applying that the holdings become the first entry, lists unmet requirements and holds confirmation', async () => {
  post.mockResolvedValueOnce({
    data: { ...PREVIEW, canDecide: false, unmetRequirements: ['boundary_changed', 'future_requirement'] },
  });
  const view = await openClass();
  await fireEvent.press(view.getByRole('button', { name: step('Apply') }));
  expect(await view.findByText(REGISTER_OPENING_UNMET_COPY.boundary_changed)).toBeTruthy();
  expect(view.getByText('future_requirement')).toBeTruthy();
  expect(view.getByText(COPY.HOLDINGS_NOTE)).toBeTruthy();
  expect(view.getAllByText(COPY.BOUNDARY_NOTE)).toHaveLength(2);
  expect(view.getByText(COPY.CONFIRMATIONS.apply)).toBeTruthy();
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(post).toHaveBeenCalledTimes(1);
});

it('previews an opening with no holdings as an empty register, and a staff-era rejection without a boundary', async () => {
  post
    .mockResolvedValueOnce({ data: { ...PREVIEW, changes: [] } })
    .mockResolvedValueOnce({ data: { ...UNREASONED, changes: [], effectiveOn: null } });
  const view = await openClass();
  await fireEvent.press(view.getByRole('button', { name: step('Apply') }));
  await view.findByText(COPY.CONFIRMATIONS.apply);
  expect(view.getByText(COPY.NO_HOLDINGS)).toBeTruthy();
  expect(view.queryByText('The register’s first entry')).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  await fireEvent.press(view.getByRole('button', { name: step('Reject', STAFF_ERA) }));
  await view.findByText(COPY.CONFIRMATIONS.reject);
  expect(view.queryByText(COPY.NO_HOLDINGS)).toBeNull();
  expect(view.queryByText('Effective date')).toBeNull();
  expect(view.getAllByText(COPY.BOUNDARY_NOTE)).toHaveLength(1);
});

it('applies an opening and shows the opened register, its entry and no further opening step', async () => {
  post.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: decided('apply', KEY(1)) });
  const view = await openClass();
  expect(await view.findByText(REGISTER_CORRECTION_COPY.ENTRIES_EMPTY)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: step('Apply') }));
  await view.findByText(COPY.CONFIRMATIONS.apply);
  register = opened;
  entries = [OPENING_ENTRY];
  openingPages = [[decided('apply', KEY(1)), STAFF], [REJECTED]];
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(await view.findByText('Entry 1 · Opening state')).toBeTruthy();
  expect(await view.findByText(`Applied · ${COPY.BOUNDARY_BLOCK(1234, '4 October 2026')}`)).toBeTruthy();
  await waitFor(() => expect(view.queryByRole('button', { name: OPEN })).toBeNull());
  expect(view.getByText('Current members · 1')).toBeTruthy();
  expect(view.queryByRole('button', { name: step('Approve') })).toBeNull();
});

it('rejects only with the reason it previewed, trimmed and at most 1,000 characters', async () => {
  appointments = [appointment('appointment-approver', ['approve'])];
  const rejection = { appointment: 'appointment-approver', reason: 'The holdings moved' };
  post
    .mockResolvedValueOnce({ data: UNREASONED })
    .mockResolvedValueOnce({ data: PREVIEW })
    .mockResolvedValueOnce({ data: decided('reject', KEY(2), rejection) });
  const view = await openClass();
  const epoch = getSessionEpoch();
  await fireEvent.press(view.getByRole('button', { name: step('Reject') }));
  expect(await view.findByText(REGISTER_OPENING_UNMET_COPY.reason_required)).toBeTruthy();
  const reason = () => view.getByLabelText(COPY.REJECTION_REASON);
  expect(reason().props.maxLength).toBe(1000);
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await fireEvent.changeText(reason(), '  The holdings moved  ');
  await fireEvent.press(view.getByRole('button', { name: 'Preview rejection' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_OPENING_PREVIEW('opening-new'),
    { appointment: 'appointment-approver', kind: 'reject', reason: 'The holdings moved' },
    { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: expect.any(Function) },
  );
  await fireEvent.changeText(reason(), 'The holdings moved again');
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await fireEvent.changeText(reason(), 'The holdings moved ');
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_OPENING_DECIDE('opening-new'),
    {
      appointment: 'appointment-approver',
      kind: 'reject',
      reason: 'The holdings moved',
      idempotencyKey: KEY(2),
      previewDigest: DIGEST,
      confirmation: true,
    },
    expect.objectContaining({ ledovaSessionEpoch: epoch }),
  );
});

it('holds a previewed decision once the step is held by another appointment', async () => {
  post.mockResolvedValueOnce({ data: PREVIEW });
  const view = await openClass();
  await fireEvent.press(view.getByRole('button', { name: step('Approve') }));
  await view.findByText(COPY.CONFIRMATIONS.approve);
  expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  appointments = [appointment('appointment-admin', ['admin']), appointment('appointment-aaa', ['approve'])];
  await act(() => view.getByTestId('register-screen').props.refreshControl.props.onRefresh());
  expect(
    await view.findByText('Your appointment for this step changed. Cancel and start this decision again.'),
  ).toBeTruthy();
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(post).toHaveBeenCalledTimes(1);
});

it('refreshes the openings, entries, holders and appointments when a decision is refused', async () => {
  post.mockResolvedValueOnce({ data: PREVIEW }).mockRejectedValueOnce({
    response: { status: 409, data: { detail: 'The register operation conflicts with its recorded identity.' } },
  });
  const view = await openClass();
  await fireEvent.press(view.getByRole('button', { name: step('Apply') }));
  await view.findByText(COPY.CONFIRMATIONS.apply);
  const before = refreshed();
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(await view.findByText('The register operation conflicts with its recorded identity.')).toBeTruthy();
  await waitFor(() => refreshed().forEach((count, index) => expect(count).toBeGreaterThan(before[index])));
  expect(view.getByRole('button', { name: 'Preview again' })).toBeEnabled();
});

it('refreshes the openings, entries, holders and appointments when a preview is refused', async () => {
  post.mockRejectedValueOnce({ response: { status: 404, data: { detail: 'Not found.' } } });
  const view = await openClass();
  const before = refreshed();
  await fireEvent.press(view.getByRole('button', { name: step('Approve') }));
  expect(await view.findByText('Not found.')).toBeTruthy();
  await waitFor(() => refreshed().forEach((count, index) => expect(count).toBeGreaterThan(before[index])));
});

it('withdraws the steps a revoked appointment held once a decision is refused', async () => {
  post.mockResolvedValueOnce({ data: PREVIEW }).mockRejectedValueOnce({
    message: 'Request failed with status code 400',
    response: { status: 400, data: { unmetRequirements: ['appointment_capability_required'] } },
  });
  const view = await openClass();
  await fireEvent.press(view.getByRole('button', { name: step('Apply') }));
  await view.findByText(COPY.CONFIRMATIONS.apply);
  appointments = [revoked('appointment-admin', ['admin'])];
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(view.queryByRole('button', { name: step('Apply') })).toBeNull());
  expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull();
  expect(view.queryByRole('button', { name: OPEN })).toBeNull();
  expect(section(view).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('leaves the cached openings unchanged when a decision receipt cannot be confirmed', async () => {
  post.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: decided('approve', 'another-key') });
  const view = await openClass();
  const key = openingsKey(getSessionEpoch(), 'ordinary');
  await fireEvent.press(view.getByRole('button', { name: step('Approve') }));
  await view.findByText(COPY.CONFIRMATIONS.approve);
  const cached = client.getQueryState(key)!;
  const before = refreshed();
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(await view.findByText(COPY.DECISION_RECEIPT_FAILED)).toBeTruthy();
  expect(refreshed()).toEqual(before);
  expect(client.getQueryState(key)).toEqual(cached);
});

it('drops an open decision when the session changes and ignores its late answer', async () => {
  const late = deferred();
  post.mockResolvedValueOnce({ data: PREVIEW }).mockReturnValueOnce(late.promise as ReturnType<typeof post>);
  const view = await openClass();
  const epoch = getSessionEpoch();
  await fireEvent.press(view.getByRole('button', { name: step('Apply') }));
  await view.findByText(COPY.CONFIRMATIONS.apply);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  await act(() => invalidateSessionScope());
  expect(view.queryByText(COPY.CONFIRMATIONS.apply)).toBeNull();
  const retired = get.mock.calls.length;
  await act(async () => late.resolve({ data: decided('apply', KEY(1)) }));
  expect(get.mock.calls.slice(retired).filter(([, config]) => config?.ledovaSessionEpoch === epoch)).toEqual([]);
  expect(client.getQueryState(openingsKey(epoch, 'ordinary'))?.errorUpdateCount).toBe(0);
  expect(view.queryByText(COPY.DECISION_RECEIPT_FAILED)).toBeNull();
  await view.findByRole('button', { name: 'Ordinary shares register' });
});

it('asks for no further page of the openings once the session changes between pages', async () => {
  const late = deferred();
  openingAnswers.set(1, () => late.promise);
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  await waitFor(() => expect(requests(URLS.REGISTER_OPENINGS)).toHaveLength(1));
  const epoch = getSessionEpoch();
  const [first] = requests(URLS.REGISTER_OPENINGS);
  openingAnswers.clear();
  await act(() => invalidateSessionScope());
  expect(first.signal.aborted).toBe(true);
  await act(async () => late.resolve(paged(openingPages, 1)));
  expect(requests(URLS.REGISTER_OPENINGS).filter((config) => config.ledovaSessionEpoch === epoch)).toEqual([
    { ledovaSessionEpoch: epoch, signal: expect.anything(), params: { token: 'ordinary', page: 1 } },
  ]);
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText(NEW_HEADING)).toBeTruthy();
  expect(requests(URLS.REGISTER_OPENINGS).slice(-2)).toEqual([
    { ledovaSessionEpoch: epoch + 1, signal: expect.anything(), params: { token: 'ordinary', page: 1 } },
    { ledovaSessionEpoch: epoch + 1, signal: expect.anything(), params: { token: 'ordinary', page: 2 } },
  ]);
});

it('shows a new session no opening or step before its own reads answer', async () => {
  const view = await openClass();
  expect(view.getByRole('button', { name: step('Approve') })).toBeTruthy();
  held = new Set([URLS.REGISTER_OPENINGS, APPOINTMENTS]);
  await act(() => invalidateSessionScope());
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText('Loading openings…')).toBeTruthy();
  expect(view.queryByText(NEW_HEADING)).toBeNull();
  expect(view.queryByRole('button', { name: step('Approve') })).toBeNull();
  expect(view.queryByRole('button', { name: OPEN })).toBeNull();
});

it('withholds opening steps while the appointments cannot be read, and offers them after a retry', async () => {
  failing = new Set([APPOINTMENTS]);
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText('Your appointments could not be read, so register actions are hidden.')).toBeTruthy();
  await view.findByText(NEW_HEADING);
  expect(view.queryByRole('button', { name: step('Approve') })).toBeNull();
  expect(view.queryByRole('button', { name: OPEN })).toBeNull();
  for (const note of [
    COPY.READ_ONLY_NOTE,
    REGISTER_IMPORT_COPY.READ_ONLY_NOTE,
    REGISTER_CORRECTION_COPY.READ_ONLY_NOTE,
    REGISTER_RECONCILIATION_COPY.READ_ONLY_NOTE,
  ])
    expect(view.queryByText(note)).toBeNull();
  failing = new Set();
  await fireEvent.press(view.getByRole('button', { name: 'Retry appointments for Ordinary shares' }));
  expect(await view.findByRole('button', { name: step('Approve') })).toBeTruthy();
  expect(view.getByRole('button', { name: OPEN })).toBeTruthy();
});

it('dates the boundary and the first entry by their calendar day for a reader west of UTC', async () => {
  const format = Date.prototype.toLocaleDateString;
  jest.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (this: Date, locale, options) {
    return format.call(this, locale, { timeZone: 'America/Los_Angeles', ...options });
  });
  post.mockResolvedValueOnce({ data: PREVIEW });
  const view = await openClass();
  expect(headings(view)).toEqual([NEW_HEADING, REJECTED_HEADING, STAFF_HEADING]);
  const description = `prepared opening at block 1234, prepared on ${formatDateTime(OPENING.createdAt)}`;
  await fireEvent.press(view.getByRole('button', { name: step('Approve', description) }));
  await view.findByText(COPY.CONFIRMATIONS.approve);
  expect(within(view.getByText('Effective date').parent!).getByText('4 October 2026')).toBeTruthy();
});

it('lists the openings before the imports of the class', async () => {
  const view = await openClass();
  const order = view
    .getAllByRole('header')
    .map(text)
    .filter((heading) => [COPY.TITLE, REGISTER_IMPORT_COPY.TITLE].includes(heading));
  expect(order).toEqual([COPY.TITLE, REGISTER_IMPORT_COPY.TITLE]);
});

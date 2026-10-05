import React from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  formatDateTime,
  REGISTER_CORRECTION_COPY as COPY,
  REGISTER_CORRECTION_UNMET_COPY,
  REGISTER_IMPORT_COPY,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { cache, resetFiles } from '../../testSupport/documentFiles';
import { CompanyRegisterScreen } from './CompanyRegisterScreen';
import { correctionsKey } from './useCompanyRegister';

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
type Entry = (typeof ENTRIES)[number];
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const DIGEST = 'a'.repeat(64);
const NEW = 'prepared correction of entry 1';
const STAFF_ERA = 'prepared correction of entry 2';
const READ_FAILED = 'The register entries could not be loaded.';
const CORRECTIONS_FAILED = 'The corrections could not be loaded.';
const KEY = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const step = (kind: string, description = NEW) => `${kind} the ${description}`;
const text = (element: { props: { children?: unknown } }) => [element.props.children].flat().join('');
const correct = (sequence: number) => `Correct entry ${sequence} of Ordinary shares`;
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const shareClass = {
  uuid: 'ordinary',
  name: 'Ordinary shares',
  symbol: 'ORD',
  companyUuid: 'paper',
  companyName: 'Paper Company',
};
const register = {
  token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'deployed', totalSupply: '1000' },
  issuedSupply: '100',
  initialized: true,
  waitingEffects: 0,
  totalHolders: 1,
  holders: [
    {
      member: 'member-1',
      name: 'Alex Member',
      holderType: 'member',
      balance: '100',
      enteredOn: '2026-09-01',
      wallets: [],
    },
  ],
};
const change = (member: string, name: string | null, shares: string) => ({ member, name, shares });
const ENTRIES = [
  {
    uuid: 'entry-3',
    sequence: 3,
    kind: 'correction',
    effectiveOn: '2026-10-04',
    recordedAt: '2026-10-05T03:00:00Z',
    changes: [change('member-1', 'Alex Member', '-10')],
    corrects: 'entry-2' as string | null,
    correctedBy: null as string | null,
    correctable: true,
  },
  {
    uuid: 'entry-2',
    sequence: 2,
    kind: 'issue',
    effectiveOn: '2026-09-10',
    recordedAt: '2026-09-10T03:00:00Z',
    changes: [change('member-1', 'Alex Member', '10')],
    corrects: null,
    correctedBy: 'entry-3',
    correctable: false,
  },
  {
    uuid: 'entry-1',
    sequence: 1,
    kind: 'opening',
    effectiveOn: '2026-09-01',
    recordedAt: '2026-09-01T03:00:00Z',
    changes: [change('member-1', 'Alex Member', '9007199254740993'), change('member-2', null, '40')],
    corrects: null,
    correctedBy: null,
    correctable: true,
  },
];
const CORRECTION = {
  uuid: 'correction-new',
  company: 'paper',
  register: 'register-ordinary',
  corrects: 'entry-1',
  baseSequence: 3,
  baseHash: 'c'.repeat(64),
  effectiveOn: '2026-10-04',
  changes: [
    { member: 'member-1', shares: '-9007199254740993' },
    { member: 'member-2', shares: '-40' },
  ],
  authority: 'director_resolution',
  approvingDirector: 'Dana Director',
  authorityReference: 'RESOLUTION-7',
  reason: 'Reverse the duplicated opening',
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
    decidedAt: kind === 'approve' ? '2026-10-04T02:00:00Z' : '2026-10-04T03:00:00Z',
    decidedBy: 1,
    decidedByName: name,
  };
}

const APPLIED = {
  ...CORRECTION,
  uuid: 'correction-applied',
  corrects: 'entry-2',
  changes: [{ member: 'member-1', shares: '-10' }],
  authority: 'court_order',
  approvingDirector: '',
  authorityReference: 'COURT-3',
  reason: 'The court ordered the issue reversed',
  preparedByName: 'Casey Preparer',
  status: 'applied',
  stage: 'applied',
  appliedEntry: 'entry-3',
  reviewedAt: '2026-10-04T03:00:00Z',
  decisions: [decision('approve', 'key-approved', { name: 'Robin Approver' }), decision('apply', 'key-applied')],
  createdAt: '2026-10-04T01:00:00Z',
};
const STAFF = {
  ...CORRECTION,
  uuid: 'correction-staff',
  corrects: 'entry-2',
  changes: [{ member: 'member-1', shares: '-10' }],
  approvingDirector: 'Sam Director',
  authorityReference: 'STAFF-RESOLUTION-2',
  reason: 'Reverse the staff-era issue',
  providedBy: 'staff_verified',
  preparedByName: null,
  preparingAppointment: null,
  authorityEvidence: null,
  sourceDocument: 'document-1',
  createdAt: '2026-10-03T01:00:00Z',
};
const OTHER_CLASS = {
  ...CORRECTION,
  uuid: 'correction-other',
  register: 'register-preference',
  corrects: 'entry-of-preference',
  reason: 'A correction of another class',
  createdAt: '2026-10-06T01:00:00Z',
};
const PREVIEW = {
  previewDigest: DIGEST,
  unmetRequirements: [] as string[],
  canDecide: true,
  registerSequence: 3,
  effectiveOn: '2026-10-04',
  originalChanges: [
    { member: 'member-1', shares: '9007199254740993' },
    { member: 'member-2', shares: '40' },
  ],
  changes: [
    { member: 'member-1', shares: '-9007199254740993' },
    { member: 'member-2', shares: '-40' },
  ],
};
const UNREASONED = { ...PREVIEW, canDecide: false, unmetRequirements: ['reason_required'] };
const PDF = { data: new Uint8Array([37, 80, 68, 70]).buffer, headers: { 'content-type': 'application/pdf' } };
let client: QueryClient;
let entryPages: Entry[][];
let correctionPages: unknown[][];
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
    ...CORRECTION,
    status: kind === 'approve' ? 'submitted' : kind === 'apply' ? 'applied' : 'rejected',
    stage: kind === 'approve' ? 'approved' : kind === 'apply' ? 'applied' : 'rejected',
    reviewedAt: kind === 'approve' ? null : recorded.decidedAt,
    rejectionReason: kind === 'reject' ? reason : '',
    appliedEntry: kind === 'apply' ? 'entry-4' : null,
    decisions: [recorded],
  };
}

const page = (results: unknown[], next: string | null = null) => ({ data: { results, next, count: results.length } });
const paged = (pages: unknown[][], number: number) =>
  page(pages[number - 1] ?? [], number < pages.length ? `https://api.example.test/?page=${number + 1}` : null);
const reads = (url: string) => get.mock.calls.filter(([called]) => called === url).length;
const refreshed = () => [
  reads(URLS.REGISTER_CORRECTIONS),
  reads(URLS.REGISTER_ENTRIES('ordinary')),
  reads(URLS.HOLDERS('ordinary')),
  reads(APPOINTMENTS),
];
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function openClass() {
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  await view.findByText('Prepared · entry 1');
  return view;
}

beforeEach(() => {
  resetFiles();
  entryPages = [[ENTRIES[1], ENTRIES[0]], [ENTRIES[2]]];
  correctionPages = [
    [OTHER_CLASS, STAFF],
    [CORRECTION, APPLIED],
  ];
  appointments = [appointment('appointment-admin', ['admin'])];
  failing = new Set();
  held = new Set();
  let keys = 0;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => KEY(++keys) as ReturnType<typeof Crypto.randomUUID>);
  mockNavigate.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
  });
  post.mockReset();
  get.mockReset().mockImplementation(async (url, config) => {
    const number = (config?.params as { page?: number } | undefined)?.page ?? 1;
    if (held.has(url)) return new Promise(() => {}) as ReturnType<typeof get>;
    if (failing.has(url)) throw new Error('Unavailable');
    if (url === URLS.REGISTER) return page([shareClass]);
    if (url === URLS.HOLDERS('ordinary')) return { data: register };
    if (url === URLS.REGISTER_IMPORTS) return page([]);
    if (url === APPOINTMENTS) return page(appointments);
    if (url === URLS.REGISTER_ENTRIES('ordinary')) return paged(entryPages, number);
    if (url === URLS.REGISTER_CORRECTIONS) return paged(correctionPages, number);
    if (url === URLS.REGISTER_CORRECTION_FILE('correction-new')) return PDF;
    throw new Error(`Unexpected ${url}`);
  });
  jest.mocked(Sharing.shareAsync).mockClear();
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

it('lists every page of the class register newest first with signed named changes and correction links', async () => {
  appointments = [appointment('appointment-reader', ['read_register'])];
  const view = await openClass();
  const epoch = getSessionEpoch();
  const session = { ledovaSessionEpoch: epoch, signal: expect.objectContaining({ aborted: false }) };
  expect(
    get.mock.calls.filter(([url]) => url === URLS.REGISTER_ENTRIES('ordinary')).map(([, config]) => config),
  ).toEqual([
    { ...session, params: { page: 1 } },
    { ...session, params: { page: 2 } },
  ]);
  expect(view.getAllByText(/^Entry \d · [A-Za-z ]+$/).map(text)).toEqual([
    'Entry 3 · Compensating correction',
    'Entry 2 · Issue',
    'Entry 1 · Opening state',
  ]);
  expect(view.getByText('Effective 4 October 2026')).toBeTruthy();
  expect(view.getByText('Effective 10 September 2026')).toBeTruthy();
  expect(view.getAllByText('Alex Member: -10').length).toBeGreaterThan(0);
  expect(view.getAllByText('Alex Member: +10').length).toBeGreaterThan(0);
  expect(view.getAllByText('Alex Member: +9,007,199,254,740,993').length).toBeGreaterThan(0);
  expect(view.getAllByText(COPY.UNNAMED_MEMBER('member-2') + ': +40').length).toBeGreaterThan(0);
  expect(within(view.getByText('Corrects').parent!).getByText('Entry 2')).toBeTruthy();
  expect(within(view.getByText('Reversed by').parent!).getByText('Entry 3')).toBeTruthy();
  expect(view.queryByRole('button', { name: correct(1) })).toBeNull();
  expect(view.queryByText(COPY.ENTRIES_EMPTY)).toBeNull();
});

it('reads every page of the company corrections and lists only the class corrections newest first', async () => {
  appointments = [appointment('appointment-reader', ['read_register'])];
  const view = await openClass();
  const epoch = getSessionEpoch();
  const session = { ledovaSessionEpoch: epoch, signal: expect.objectContaining({ aborted: false }) };
  expect(get.mock.calls.filter(([url]) => url === URLS.REGISTER_CORRECTIONS).map(([, config]) => config)).toEqual([
    { ...session, params: { company: 'paper', page: 1 } },
    { ...session, params: { company: 'paper', page: 2 } },
  ]);
  expect(view.getAllByText(/ · entry \d$/).map(text)).toEqual([
    'Prepared · entry 1',
    'Applied · entry 2',
    'Prepared · entry 2',
  ]);
  expect(view.queryByText('A correction of another class')).toBeNull();
  expect(view.getAllByText(COPY.PROVIDED_BY_COMPANY)).toHaveLength(2);
  expect(view.getByText(COPY.STAFF_VERIFIED)).toBeTruthy();
  expect(view.getByText('Pat Preparer')).toBeTruthy();
  expect(view.getByText(formatDateTime(CORRECTION.createdAt))).toBeTruthy();
  expect(view.getAllByText('4 October 2026')).toHaveLength(3);
  expect(view.getAllByText(COPY.AUTHORITIES.director_resolution)).toHaveLength(2);
  expect(view.getByText('Dana Director')).toBeTruthy();
  expect(view.getByText('RESOLUTION-7')).toBeTruthy();
  expect(view.getByText('Reverse the duplicated opening')).toBeTruthy();
  expect(view.getByText(COPY.AUTHORITIES.court_order)).toBeTruthy();
  expect(view.getByText('COURT-3')).toBeTruthy();
  expect(view.getByText(`Robin Approver · ${formatDateTime('2026-10-04T02:00:00Z')}`)).toBeTruthy();
  expect(view.getByText(`Ari Admin · ${formatDateTime('2026-10-04T03:00:00Z')}`)).toBeTruthy();
  expect(view.getAllByText(COPY.APPROVING_DIRECTOR)).toHaveLength(2);
  expect(view.getByText('Entry 1 · Opening state · effective 1 September 2026')).toBeTruthy();
  expect(view.getAllByText('Alex Member: -9,007,199,254,740,993')).toHaveLength(1);
  expect(view.getAllByText(COPY.UNNAMED_MEMBER('member-2') + ': -40')).toHaveLength(1);
  expect(view.getAllByText(COPY.READ_ONLY_NOTE)).toHaveLength(1);
  expect(view.queryByText(/verified by Ledova(?! staff before)/i)).toBeNull();
  for (const kind of ['Approve', 'Apply', 'Reject'])
    expect(view.queryByRole('button', { name: step(kind) })).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: `${COPY.DOWNLOAD} of the ${NEW}` }));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(`${cache}ledova-document-views-v1/authority-correction-new.pdf`, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
    }),
  );
  expect(get).toHaveBeenCalledWith(URLS.REGISTER_CORRECTION_FILE('correction-new'), {
    responseType: 'arraybuffer',
    ledovaSessionEpoch: epoch,
  });
  await waitFor(() => expect(view.getByRole('button', { name: `${COPY.DOWNLOAD} of the ${NEW}` })).toBeEnabled());
});

it('shows a decided staff-era correction without a trail by its decision time and rejection reason', async () => {
  correctionPages = [
    [
      CORRECTION,
      {
        ...STAFF,
        status: 'rejected',
        stage: 'rejected',
        decisions: [],
        reviewedAt: '2026-10-04T05:00:00Z',
        rejectionReason: 'Superseded by a company correction',
      },
    ],
  ];
  const view = await openClass();
  expect(view.getByText('Rejected · entry 2')).toBeTruthy();
  expect(view.getByText('Decided on')).toBeTruthy();
  expect(view.getByText(formatDateTime('2026-10-04T05:00:00Z'))).toBeTruthy();
  expect(view.getByText('Superseded by a company correction')).toBeTruthy();
  expect(view.queryByRole('button', { name: step('Reject', 'rejected correction of entry 2') })).toBeNull();
});

it('shows the history a page at a time and loads more entries on request', async () => {
  const entries = Array.from({ length: 30 }, (_, index) => ({
    ...ENTRIES[1],
    uuid: `entry-${30 - index}`,
    sequence: 30 - index,
    correctedBy: null,
    correctable: true,
  }));
  entryPages = [entries.slice(0, 25), entries.slice(25)];
  correctionPages = [[CORRECTION]];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  await view.findByText('Entry 30 · Issue');
  expect(reads(URLS.REGISTER_ENTRIES('ordinary'))).toBe(2);
  expect(view.getAllByText(/^Entry \d+ · Issue$/)).toHaveLength(25);
  expect(view.getByText('Entry 6 · Issue')).toBeTruthy();
  expect(view.queryByText('Entry 5 · Issue')).toBeNull();
  expect(view.getByText('Prepared · entry 1')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Load more entries of Ordinary shares' }));
  expect(view.getAllByText(/^Entry \d+ · Issue$/)).toHaveLength(30);
  expect(view.getByText('Entry 1 · Issue')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Load more entries of Ordinary shares' })).toBeNull();
  expect(reads(URLS.REGISTER_ENTRIES('ordinary'))).toBe(2);
});

it('says a class without register entries or corrections has none', async () => {
  entryPages = [[]];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText(COPY.ENTRIES_EMPTY)).toBeTruthy();
  expect(await view.findByText(COPY.EMPTY)).toBeTruthy();
  expect(view.queryByText('A correction of another class')).toBeNull();
});

it.each([
  ['approval and rejection', ['approve'], ['Approve', 'Reject'], false],
  ['application', ['apply'], ['Apply'], false],
  ['preparation', ['prepare'], [], true],
  ['every step', ['admin'], ['Approve', 'Apply', 'Reject'], true],
])('offers %s only through an effective appointment holding it', async (_, capabilities, offered, prepares) => {
  appointments = [appointment('appointment-step', capabilities)];
  const view = await openClass();
  for (const kind of ['Approve', 'Apply', 'Reject']) {
    expect(!!view.queryByRole('button', { name: step(kind) })).toBe(offered.includes(kind));
    expect(view.queryByRole('button', { name: step(kind, 'applied correction of entry 2') })).toBeNull();
  }
  expect(!!view.queryByRole('button', { name: correct(1) })).toBe(prepares);
  expect(!!view.queryByRole('button', { name: correct(3) })).toBe(prepares);
  expect(view.queryByRole('button', { name: correct(2) })).toBeNull();
  expect(view.queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
});

it.each([
  ['a register reader', [appointment('appointment-reader', ['read_register'])]],
  ['an expired administrator', [appointment('appointment-expired', ['admin'], { expiresAt: '2020-01-01T00:00:00Z' })]],
  ['another company administrator', [appointment('appointment-other', ['admin'], { company: 'garden' })]],
])('shows %s the history and corrections read-only', async (_, own) => {
  appointments = own;
  const view = await openClass();
  expect(view.getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  for (const kind of ['Approve', 'Apply', 'Reject'])
    expect(view.queryByRole('button', { name: step(kind) })).toBeNull();
  expect(view.queryByRole('button', { name: step('Reject', STAFF_ERA) })).toBeNull();
  expect(view.queryByRole('button', { name: correct(1) })).toBeNull();
});

it('offers a retained staff-era correction only rejection, beside a company correction offering every step', async () => {
  const view = await openClass();
  expect(view.getByRole('button', { name: step('Reject', STAFF_ERA) })).toBeTruthy();
  expect(view.queryByRole('button', { name: step('Approve', STAFF_ERA) })).toBeNull();
  expect(view.queryByRole('button', { name: step('Apply', STAFF_ERA) })).toBeNull();
  for (const kind of ['Approve', 'Apply', 'Reject'])
    expect(view.getByRole('button', { name: step(kind) })).toBeTruthy();
});

it('opens the preparation of a correctable entry with its class, company and entry', async () => {
  appointments = [appointment('appointment-prepare', ['prepare'])];
  const view = await openClass();
  await fireEvent.press(view.getByRole('button', { name: correct(1) }));
  expect(mockNavigate).toHaveBeenCalledWith('PrepareRegisterCorrection', {
    tokenUuid: 'ordinary',
    companyUuid: 'paper',
    entryUuid: 'entry-1',
  });
});

it('withdraws every correction step once a pull to refresh reads the appointment as revoked', async () => {
  const view = await openClass();
  expect(view.getByRole('button', { name: step('Approve') })).toBeTruthy();
  appointments = [revoked('appointment-admin', ['admin'])];
  await act(() => view.getByTestId('register-screen').props.refreshControl.props.onRefresh());
  await waitFor(() => expect(view.queryByRole('button', { name: step('Approve') })).toBeNull());
  expect(view.queryByRole('button', { name: correct(1) })).toBeNull();
  expect(view.queryByRole('button', { name: step('Reject', STAFF_ERA) })).toBeNull();
  expect(view.getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('previews an approval with the named original and inverse changes and the register sequence, then records it', async () => {
  post.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: decided('approve', KEY(1)) });
  const view = await openClass();
  const epoch = getSessionEpoch();
  const before = refreshed();
  await fireEvent.press(view.getByRole('button', { name: step('Approve') }));
  expect(await view.findByText(COPY.CONFIRMATIONS.approve)).toBeTruthy();
  expect(post).toHaveBeenCalledWith(
    URLS.REGISTER_CORRECTION_PREVIEW('correction-new'),
    { appointment: 'appointment-admin', kind: 'approve', reason: '' },
    { ledovaSessionEpoch: epoch },
  );
  expect(view.getByText('Register sequence')).toBeTruthy();
  expect(within(view.getByText('Register sequence').parent!).getByText('3')).toBeTruthy();
  expect(view.getAllByText('Alex Member: +9,007,199,254,740,993').length).toBe(3);
  expect(view.getAllByText('Alex Member: -9,007,199,254,740,993').length).toBe(2);
  expect(view.getAllByText(COPY.UNNAMED_MEMBER('member-2') + ': -40').length).toBe(2);
  expect(view.getAllByText(COPY.COMPENSATION_NOTE)).toHaveLength(1);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_CORRECTION_DECIDE('correction-new'),
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

it('lists unmet requirements in words, notes the compensation before applying and holds the confirmation', async () => {
  post.mockResolvedValueOnce({
    data: { ...PREVIEW, canDecide: false, unmetRequirements: ['approval_lapsed', 'future_requirement'] },
  });
  const view = await openClass();
  await fireEvent.press(view.getByRole('button', { name: step('Apply') }));
  expect(await view.findByText(REGISTER_CORRECTION_UNMET_COPY.approval_lapsed)).toBeTruthy();
  expect(view.getByText('future_requirement')).toBeTruthy();
  expect(view.getByText(COPY.CONFIRMATIONS.apply)).toBeTruthy();
  expect(view.getAllByText(COPY.COMPENSATION_NOTE)).toHaveLength(2);
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(post).toHaveBeenCalledTimes(1);
});

it('applies a correction once its receipt names the compensating entry', async () => {
  post
    .mockResolvedValueOnce({ data: PREVIEW })
    .mockResolvedValueOnce({ data: { ...decided('apply', KEY(1)), appliedEntry: null } })
    .mockResolvedValueOnce({ data: PREVIEW })
    .mockResolvedValueOnce({ data: decided('apply', KEY(1)) });
  const view = await openClass();
  await fireEvent.press(view.getByRole('button', { name: step('Apply') }));
  await view.findByText(COPY.CONFIRMATIONS.apply);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(await view.findByText(COPY.DECISION_RECEIPT_FAILED)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  await fireEvent.press(view.getByRole('button', { name: step('Apply') }));
  await view.findByText(COPY.CONFIRMATIONS.apply);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  const decide = post.mock.calls.filter(([url]) => url === URLS.REGISTER_CORRECTION_DECIDE('correction-new'));
  expect(decide.map(([, body]) => (body as { idempotencyKey: string }).idempotencyKey)).toEqual([KEY(1), KEY(1)]);
});

it('rejects only with the reason it previewed, trimmed and at most 1,000 characters', async () => {
  appointments = [appointment('appointment-approver', ['approve'])];
  const rejection = { appointment: 'appointment-approver', reason: 'Wrong entry' };
  post
    .mockResolvedValueOnce({ data: UNREASONED })
    .mockResolvedValueOnce({ data: PREVIEW })
    .mockResolvedValueOnce({ data: decided('reject', KEY(2), rejection) });
  const view = await openClass();
  const epoch = getSessionEpoch();
  await fireEvent.press(view.getByRole('button', { name: step('Reject') }));
  expect(await view.findByText(REGISTER_CORRECTION_UNMET_COPY.reason_required)).toBeTruthy();
  const reason = () => view.getByLabelText(COPY.REJECTION_REASON);
  expect(reason().props.maxLength).toBe(1000);
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await fireEvent.changeText(reason(), '  Wrong entry  ');
  await fireEvent.press(view.getByRole('button', { name: 'Preview rejection' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_CORRECTION_PREVIEW('correction-new'),
    { appointment: 'appointment-approver', kind: 'reject', reason: 'Wrong entry' },
    { ledovaSessionEpoch: epoch },
  );
  await fireEvent.changeText(reason(), 'Wrong entry, and late');
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  expect(view.getByRole('button', { name: 'Preview rejection' })).toBeEnabled();
  await fireEvent.changeText(reason(), 'Wrong entry ');
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_CORRECTION_DECIDE('correction-new'),
    {
      appointment: 'appointment-approver',
      kind: 'reject',
      reason: 'Wrong entry',
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

it('refreshes the corrections, entries, holders and appointments when a decision is refused', async () => {
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
  expect(view.queryByRole('button', { name: correct(1) })).toBeNull();
  expect(view.getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('leaves the cached corrections unchanged when a decision receipt cannot be confirmed', async () => {
  post.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: decided('approve', 'another-key') });
  const view = await openClass();
  const key = correctionsKey(getSessionEpoch(), 'paper');
  await fireEvent.press(view.getByRole('button', { name: step('Approve') }));
  await view.findByText(COPY.CONFIRMATIONS.approve);
  const cached = client.getQueryState(key)!;
  const before = refreshed();
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(await view.findByText(COPY.DECISION_RECEIPT_FAILED)).toBeTruthy();
  expect(refreshed()).toEqual(before);
  expect(client.getQueryState(key)).toEqual(cached);
});

it('retries an interrupted decision under its key until the preview changes', async () => {
  post
    .mockResolvedValueOnce({ data: PREVIEW })
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce({ data: PREVIEW })
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce({ data: { ...PREVIEW, previewDigest: 'b'.repeat(64) } })
    .mockRejectedValueOnce(new Error('Network Error'));
  const view = await openClass();
  const decide = () => post.mock.calls.filter(([url]) => url === URLS.REGISTER_CORRECTION_DECIDE('correction-new'));
  for (let attempt = 0; attempt < 3; attempt++) {
    await fireEvent.press(view.getByRole('button', { name: step('Approve') }));
    await view.findByText(COPY.CONFIRMATIONS.approve);
    await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
    await view.findByText('Network Error');
    await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  }
  expect(decide().map(([, body]) => (body as { idempotencyKey: string }).idempotencyKey)).toEqual([
    KEY(1),
    KEY(1),
    KEY(2),
  ]);
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
  expect(client.getQueryState(correctionsKey(epoch, 'paper'))?.errorUpdateCount).toBe(0);
  expect(view.queryByText(COPY.DECISION_RECEIPT_FAILED)).toBeNull();
  await view.findByRole('button', { name: 'Ordinary shares register' });
});

it('shows a new session no correction or step before its own reads answer', async () => {
  const view = await openClass();
  expect(view.getByRole('button', { name: step('Approve') })).toBeTruthy();
  held = new Set([URLS.REGISTER_CORRECTIONS, URLS.REGISTER_ENTRIES('ordinary'), APPOINTMENTS]);
  await act(() => invalidateSessionScope());
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText('Loading corrections…')).toBeTruthy();
  expect(await view.findByText(REGISTER_IMPORT_COPY.EMPTY)).toBeTruthy();
  expect(view.getByText('Loading register entries…')).toBeTruthy();
  expect(view.queryByText('Prepared · entry 1')).toBeNull();
  expect(view.queryByRole('button', { name: step('Approve') })).toBeNull();
  expect(view.queryByRole('button', { name: correct(1) })).toBeNull();
});

it.each([
  ['a fractional change', () => (entryPages = [[{ ...ENTRIES[2], changes: [change('member-1', 'Alex', '1.5')] }]])],
  [
    'an entry listed twice',
    () =>
      (entryPages = [
        [ENTRIES[0], ENTRIES[1]],
        [ENTRIES[1], ENTRIES[2]],
      ]),
  ],
  ['a link to an entry the read missed', () => (entryPages = [[ENTRIES[0], ENTRIES[2]]])],
])('refuses a register history with %s, hides the corrections and retries', async (_, malformed) => {
  malformed();
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText(READ_FAILED)).toBeTruthy();
  expect(view.getByText(CORRECTIONS_FAILED)).toBeTruthy();
  expect(view.queryByText('Prepared · entry 1')).toBeNull();
  expect(view.queryByRole('button', { name: correct(1) })).toBeNull();
  entryPages = [[ENTRIES[1], ENTRIES[0]], [ENTRIES[2]]];
  await fireEvent.press(view.getByRole('button', { name: 'Retry register entries for Ordinary shares' }));
  expect(await view.findByText('Prepared · entry 1')).toBeTruthy();
  expect(view.queryByText(CORRECTIONS_FAILED)).toBeNull();
});

it('refuses corrections that name another company and retries them alone', async () => {
  correctionPages = [[CORRECTION, { ...STAFF, company: 'garden' }]];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText(CORRECTIONS_FAILED)).toBeTruthy();
  expect(view.queryByText('Prepared · entry 1')).toBeNull();
  expect(view.getByText('Entry 1 · Opening state')).toBeTruthy();
  correctionPages = [[CORRECTION]];
  await fireEvent.press(view.getByRole('button', { name: 'Retry corrections for Ordinary shares' }));
  expect(await view.findByText('Prepared · entry 1')).toBeTruthy();
});

it('withholds correction steps while the appointments cannot be read', async () => {
  failing = new Set([APPOINTMENTS]);
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText('Your appointments could not be read, so register actions are hidden.')).toBeTruthy();
  await view.findByText('Prepared · entry 1');
  expect(view.queryByRole('button', { name: step('Approve') })).toBeNull();
  expect(view.queryByRole('button', { name: correct(1) })).toBeNull();
  expect(view.queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
  failing = new Set();
  await fireEvent.press(view.getByRole('button', { name: 'Retry appointments for Ordinary shares' }));
  expect(await view.findByRole('button', { name: step('Approve') })).toBeTruthy();
  expect(view.getByRole('button', { name: correct(1) })).toBeTruthy();
});

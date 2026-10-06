import React from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  formatDateTime,
  HOLDER_TYPE_LABELS,
  REGISTER_CORRECTION_COPY,
  REGISTER_LINK_COPY as COPY,
  type RegisterDecisionKind,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import * as sessionScope from '../../services/sessionScope';
import { cache, resetFiles } from '../../testSupport/documentFiles';
import { CompanyRegisterScreen } from './CompanyRegisterScreen';

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

type Params = { page?: number; company?: string };
type Request = { params: Params; ledovaSessionEpoch: number; signal: AbortSignal };
const KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const LINKS = URLS.REGISTER_LINKS;
const HOLDERS = URLS.HOLDERS('ordinary');
const ENTRIES_URL = URLS.REGISTER_ENTRIES('ordinary');
const EMPTY: string[] = [
  URLS.REGISTER_OPENINGS,
  URLS.REGISTER_IMPORTS,
  URLS.REGISTER_CORRECTIONS,
  URLS.REGISTER_RECONCILIATIONS,
  URLS.REGISTER_PARTICULARS_CHANGES,
  ENTRIES_URL,
];
const DIGEST = 'a'.repeat(64);
const ADA = '0xAdA0000000000000000000000000000000000a01';
const BEA = '0xBea0000000000000000000000000000000000b02';
const CY = '0xC000000000000000000000000000000000000c03';
const DEE = '0xDee0000000000000000000000000000000000d04';
const EVE = '0xEee0000000000000000000000000000000000e05';
const MEMBER_A = '10000000-0000-4000-8000-0000000000aa';
const MEMBER_GONE = '10000000-0000-4000-8000-0000000000bb';
const FRESH_X = '20000000-0000-4000-8000-0000000000aa';
const KEY = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const prepared = (createdAt: string) => `prepared on ${formatDateTime(createdAt)}`;
const NEW = `${COPY.STAGES.submitted.toLowerCase()} wallet link for 3 wallets, ${prepared('2026-10-06T01:00:00Z')}`;
const STAFF_ERA = `${COPY.STAGES.submitted.toLowerCase()} wallet link for 1 wallet, ${prepared('2026-10-02T01:00:00Z')}`;
const REJECTED_ONE = `${COPY.STAGES.rejected.toLowerCase()} wallet link for 1 wallet, ${prepared('2026-10-05T01:00:00Z')}`;
const NEW_HEADING = `${COPY.STAGES.submitted} · 3 wallets`;
const REJECTED_HEADING = `${COPY.STAGES.rejected} · 1 wallet`;
const STAFF_HEADING = `${COPY.STAGES.submitted} · 1 wallet`;
const step = (kind: RegisterDecisionKind, description = NEW) => `${COPY.DECISIONS[kind]} the ${description}`;
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
const register = {
  token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'deployed', totalSupply: '1000' },
  issuedSupply: '100',
  initialized: true,
  waitingEffects: 2,
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

function decision(
  kind: RegisterDecisionKind,
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
    decidedAt: '2026-10-06T05:00:00Z',
    decidedBy: 1,
    decidedByName: name,
  };
}

const LINK = {
  uuid: 'link-new',
  company: 'paper',
  mapping: [
    { address: ADA, member: MEMBER_A },
    { address: BEA, member: FRESH_X },
    { address: CY, member: MEMBER_GONE },
  ],
  mappingSummary: [
    { address: ADA, member: MEMBER_A, memberExists: true },
    { address: BEA, member: FRESH_X, memberExists: false },
    { address: CY, member: MEMBER_GONE, memberExists: true },
  ],
  authority: 'director_resolution',
  approvingDirector: 'Dana Director',
  authorityReference: 'RESOLUTION-12',
  reason: 'Link the wallets of the September subscribers',
  sourceDocument: null as string | null,
  evidenceFingerprint: 'd'.repeat(64),
  evidenceSnapshot: {},
  authorityEvidence: 'evidence-authority' as string | null,
  preparingAppointment: 'appointment-prepare' as string | null,
  preparedByName: 'Pat Preparer' as string | null,
  providedBy: 'company',
  submittedBy: 1,
  reviewedBy: null,
  status: 'submitted',
  stage: 'submitted',
  reviewedAt: null as string | null,
  rejectionReason: '',
  decisions: [] as unknown[],
  createdAt: '2026-10-06T01:00:00Z',
};
const REJECTED = {
  ...LINK,
  uuid: 'link-rejected',
  mapping: [{ address: DEE, member: FRESH_X }],
  mappingSummary: [{ address: DEE, member: FRESH_X, memberExists: false }],
  authority: 'court_order',
  approvingDirector: '',
  authorityReference: 'COURT-7',
  reason: 'Link the buyer’s wallet under the court order',
  preparedByName: 'Casey Preparer',
  status: 'rejected',
  stage: 'rejected',
  reviewedAt: '2026-10-05T03:00:00Z',
  rejectionReason: 'The order names another wallet',
  decisions: [
    { ...decision('approve', 'key-approved', { name: 'Robin Approver' }), decidedAt: '2026-10-05T02:00:00Z' },
    {
      ...decision('reject', 'key-rejected', { reason: 'The order names another wallet' }),
      decidedAt: '2026-10-05T03:00:00Z',
    },
  ],
  createdAt: '2026-10-05T01:00:00Z',
};
const STAFF = {
  ...LINK,
  uuid: 'link-staff',
  mapping: [{ address: EVE, member: MEMBER_A }],
  mappingSummary: [{ address: EVE, member: MEMBER_A, memberExists: true }],
  approvingDirector: 'Sam Director',
  authorityReference: 'STAFF-RESOLUTION-3',
  reason: 'Link the second wallet of Alex Member',
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
  links: [
    {
      address: ADA,
      member: MEMBER_A,
      memberExists: true,
      walletProof: 'proven',
      holderType: 'member',
      holderName: 'Alex Member',
    },
    {
      address: BEA,
      member: FRESH_X,
      memberExists: false,
      walletProof: 'not_proven',
      holderType: 'unidentified',
      holderName: null,
    },
    { address: CY, member: MEMBER_GONE, memberExists: true, walletProof: null, holderType: null, holderName: null },
  ],
};
const PDF = { data: new Uint8Array([37, 80, 68, 70]).buffer, headers: { 'content-type': 'application/pdf' } };
let client: QueryClient;
let linkPages: unknown[][];
let linkAnswers: Map<number, () => Promise<unknown>>;
let appointments: unknown[];

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
  appointment(uuid, capabilities, { isEffective: false, status: 'revoked', revokedAt: '2026-10-06T00:00:00Z' });

function decided(kind: RegisterDecisionKind, key: string) {
  const recorded = decision(kind, key);
  return {
    ...LINK,
    status: kind === 'approve' ? 'submitted' : kind === 'apply' ? 'applied' : 'rejected',
    stage: kind === 'approve' ? 'approved' : kind === 'apply' ? 'applied' : 'rejected',
    reviewedAt: kind === 'approve' ? null : recorded.decidedAt,
    decisions: [recorded],
  };
}

const page = (results: unknown[], next: string | null = null) => ({ data: { results, next, count: results.length } });
const paged = (pages: unknown[][], number: number) =>
  page(pages[number - 1] ?? [], number < pages.length ? `https://api.example.test/?page=${number + 1}` : null);
const reads = (url: string) => get.mock.calls.filter(([called]) => called === url).length;
const requests = (url: string) =>
  get.mock.calls.filter(([called]) => called === url).map(([, config]) => config as Request);
const refreshed = () => [reads(LINKS), reads(HOLDERS), reads(ENTRIES_URL), reads(APPOINTMENTS)];
const headings = (view: Awaited<ReturnType<typeof render>>) =>
  view.getAllByText(/^(Prepared|Approved|Applied|Rejected) · \d+ wallets?$/).map(text);
const section = (view: Awaited<ReturnType<typeof render>>) => within(view.getByText(COPY.TITLE).parent!);
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

async function openRegister() {
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await view.findByText(NEW_HEADING);
  return view;
}

async function openClass(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(view.getByRole('button', { name: 'Ordinary shares register' }));
  await view.findByText(REGISTER_CORRECTION_COPY.ENTRIES_EMPTY);
}

beforeEach(() => {
  resetFiles();
  linkPages = [
    [REJECTED, STAFF],
    [LINK, REJECTED],
  ];
  linkAnswers = new Map();
  appointments = [appointment('appointment-admin', ['admin'])];
  let keys = 0;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => KEY(++keys) as ReturnType<typeof Crypto.randomUUID>);
  mockNavigate.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
  });
  post.mockReset();
  get.mockReset().mockImplementation(async (url, config) => {
    const number = ((config?.params ?? {}) as Params).page ?? 1;
    if (url === URLS.REGISTER) return page([shareClass]);
    if (url === HOLDERS) return { data: register };
    if (url === APPOINTMENTS) return page(appointments);
    if (url === LINKS) return linkAnswers.get(number)?.() ?? paged(linkPages, number);
    if (url === URLS.REGISTER_LINK_FILE('link-new')) return PDF;
    if (EMPTY.includes(url)) return page([]);
    throw new Error(`Unexpected ${url}`);
  });
  jest.mocked(Sharing.shareAsync).mockClear();
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

it('reads every page of the company’s wallet links and lists each once, newest first, with its wallets and trail', async () => {
  appointments = [appointment('appointment-reader', ['read_register'])];
  const view = await openRegister();
  const epoch = sessionScope.getSessionEpoch();
  const session = { ledovaSessionEpoch: epoch, signal: expect.objectContaining({ aborted: false }) };
  expect(requests(LINKS)).toEqual([
    { ...session, params: { company: 'paper', page: 1 } },
    { ...session, params: { company: 'paper', page: 2 } },
  ]);
  expect(headings(view)).toEqual([NEW_HEADING, REJECTED_HEADING, STAFF_HEADING]);
  const record = within(view.getByText(NEW_HEADING).parent!);
  for (const shown of [
    COPY.PROVIDED_BY_COMPANY,
    'Pat Preparer',
    formatDateTime(LINK.createdAt),
    COPY.AUTHORITIES.director_resolution,
    'Dana Director',
    'RESOLUTION-12',
    'Link the wallets of the September subscribers',
    ADA,
    BEA,
    CY,
  ])
    expect(record.getByText(shown)).toBeTruthy();
  expect(record.getAllByText(/^(Alex Member|New member|Existing member)$/).map(text)).toEqual([
    'Alex Member',
    COPY.NEW_MEMBER,
    COPY.EXISTING_MEMBER,
  ]);
  const rejected = within(view.getByText(REJECTED_HEADING).parent!);
  const trail = (label: string) => within(rejected.getByText(label).parent!);
  expect(
    trail(COPY.STAGES.approved).getByText(`Robin Approver · ${formatDateTime('2026-10-05T02:00:00Z')}`),
  ).toBeTruthy();
  expect(trail(COPY.STAGES.rejected).getByText(`Ari Admin · ${formatDateTime('2026-10-05T03:00:00Z')}`)).toBeTruthy();
  expect(rejected.getByText('The order names another wallet')).toBeTruthy();
  expect(rejected.getByText(COPY.AUTHORITIES.court_order)).toBeTruthy();
  expect(rejected.queryByText(COPY.APPROVING_DIRECTOR)).toBeNull();
  const staff = within(view.getByText(STAFF_HEADING).parent!);
  expect(staff.getByText(COPY.STAFF_VERIFIED)).toBeTruthy();
  expect(staff.queryByText('Prepared by')).toBeNull();
  expect(view.queryByText(/verified by Ledova(?! staff before)/i)).toBeNull();
  expect(section(view).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: `${COPY.DOWNLOAD} of the ${NEW}` }));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(`${cache}ledova-document-views-v1/authority-link-new.pdf`, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
    }),
  );
  expect(get).toHaveBeenCalledWith(URLS.REGISTER_LINK_FILE('link-new'), {
    responseType: 'arraybuffer',
    ledovaSessionEpoch: epoch,
  });
  await waitFor(() => expect(view.getByRole('button', { name: `${COPY.DOWNLOAD} of the ${NEW}` })).toBeEnabled());
  for (const description of [STAFF_ERA, REJECTED_ONE])
    expect(view.getByRole('button', { name: `${COPY.DOWNLOAD} of the ${description}` })).toBeTruthy();
  const names = view
    .getAllByRole('button')
    .map((button) => String(button.props.accessibilityLabel ?? ''))
    .filter(Boolean);
  expect(names.filter((name) => /link-|0x[0-9a-f]{6}|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name))).toEqual([]);
});

it.each([
  ['approval and rejection to an approver', ['approve'], ['approve', 'reject'], false],
  ['application to an appointee who applies', ['apply'], ['apply'], false],
  ['every step to an administrator', ['admin'], KINDS, true],
  ['only preparation to a preparer', ['prepare'], [], true],
  ['nothing to a register reader', ['read_register'], [], false],
])('offers %s', async (_, capabilities, offered, prepares) => {
  appointments = [appointment('appointment-step', capabilities)];
  const view = await openRegister();
  for (const kind of KINDS) {
    expect(!!view.queryByRole('button', { name: step(kind) })).toBe(offered.includes(kind));
    expect(view.queryByRole('button', { name: step(kind, REJECTED_ONE) })).toBeNull();
  }
  expect(!!view.queryByRole('button', { name: step('reject', STAFF_ERA) })).toBe(offered.includes('reject'));
  expect(view.queryByRole('button', { name: step('approve', STAFF_ERA) })).toBeNull();
  expect(view.queryByRole('button', { name: step('apply', STAFF_ERA) })).toBeNull();
  expect(!!section(view).queryByText(COPY.READ_ONLY_NOTE)).toBe(offered.length === 0 && !prepares);
});

it('offers another company’s administrator nothing', async () => {
  appointments = [appointment('appointment-other', ['admin'], { company: 'garden' })];
  const view = await openRegister();
  for (const kind of KINDS) expect(view.queryByRole('button', { name: step(kind) })).toBeNull();
  expect(view.queryByRole('button', { name: step('reject', STAFF_ERA) })).toBeNull();
  expect(section(view).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('shows a newly prepared wallet link after a pull to refresh', async () => {
  const view = await openRegister();
  linkPages = [[{ ...LINK, uuid: 'link-later', createdAt: '2026-10-06T09:00:00Z' }, LINK]];
  await act(() => view.getByTestId('register-screen').props.refreshControl.props.onRefresh());
  await waitFor(() => expect(view.getAllByText(NEW_HEADING)).toHaveLength(2));
  expect(view.queryByText(REJECTED_HEADING)).toBeNull();
});

it('previews an application with each wallet’s member and the holder’s own proof, records it and refreshes', async () => {
  post.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: decided('apply', KEY(1)) });
  const view = await openRegister();
  await openClass(view);
  const epoch = sessionScope.getSessionEpoch();
  await fireEvent.press(view.getByRole('button', { name: step('apply') }));
  expect(await view.findByText(COPY.CONFIRMATIONS.apply)).toBeTruthy();
  expect(post).toHaveBeenCalledWith(
    URLS.REGISTER_LINK_PREVIEW('link-new'),
    { appointment: 'appointment-admin', kind: 'apply', reason: '' },
    { ledovaSessionEpoch: epoch },
  );
  expect(view.getByText(`${COPY.DECISIONS.apply} wallet link`)).toBeTruthy();
  expect(view.getByText(COPY.APPLY_NOTE)).toBeTruthy();
  expect(view.getByText(COPY.STATUS_NOTE)).toBeTruthy();
  const wallet = (address: string) => within(view.getAllByText(address).at(-1)!.parent!);
  expect(wallet(ADA).getByText(COPY.WALLET_PROOF.proven)).toBeTruthy();
  expect(within(wallet(ADA).getByText(COPY.HOLDER).parent!).getByText('Alex Member')).toBeTruthy();
  expect(within(wallet(ADA).getByText(COPY.MEMBER).parent!).getByText('Alex Member')).toBeTruthy();
  expect(wallet(BEA).getByText(COPY.WALLET_PROOF.not_proven)).toBeTruthy();
  expect(within(wallet(BEA).getByText(COPY.HOLDER).parent!).getByText(HOLDER_TYPE_LABELS.unidentified)).toBeTruthy();
  expect(within(wallet(BEA).getByText(COPY.MEMBER).parent!).getByText(COPY.NEW_MEMBER)).toBeTruthy();
  expect(wallet(CY).getByText(COPY.NO_STATUS)).toBeTruthy();
  expect(wallet(CY).queryByText(COPY.HOLDER)).toBeNull();
  expect(within(wallet(CY).getByText(COPY.MEMBER).parent!).getByText(COPY.EXISTING_MEMBER)).toBeTruthy();
  expect(within(view.getByText(COPY.STATUS_NOTE).parent!).queryByText(/verified/i)).toBeNull();
  const before = refreshed();
  linkPages = [[decided('apply', KEY(1)), STAFF]];
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_LINK_DECIDE('link-new'),
    {
      appointment: 'appointment-admin',
      kind: 'apply',
      reason: '',
      idempotencyKey: KEY(1),
      previewDigest: DIGEST,
      confirmation: true,
    },
    { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: expect.any(Function) },
  );
  await waitFor(() => refreshed().forEach((count, index) => expect(count).toBeGreaterThan(before[index])));
  expect(await view.findByText(`${COPY.STAGES.applied} · 3 wallets`)).toBeTruthy();
  expect(view.queryByRole('button', { name: step('approve') })).toBeNull();
});

it('refreshes after a refused decision and withdraws the steps a revoked appointment held', async () => {
  post.mockResolvedValueOnce({ data: PREVIEW }).mockRejectedValueOnce({
    message: 'Request failed with status code 400',
    response: { status: 400, data: { unmetRequirements: ['appointment_capability_required'] } },
  });
  const view = await openRegister();
  await openClass(view);
  await fireEvent.press(view.getByRole('button', { name: step('approve') }));
  await view.findByText(COPY.CONFIRMATIONS.approve);
  const before = refreshed();
  appointments = [revoked('appointment-admin', ['admin'])];
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => refreshed().forEach((count, index) => expect(count).toBeGreaterThan(before[index])));
  await waitFor(() => expect(view.queryByRole('button', { name: step('approve') })).toBeNull());
  expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull();
  expect(view.queryByRole('button', { name: step('reject', STAFF_ERA) })).toBeNull();
  expect(section(view).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('refuses wallet links that name another company, and reads them again on request', async () => {
  linkPages = [[LINK, { ...REJECTED, company: 'garden' }]];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  expect(await view.findByRole('button', { name: 'Retry wallet links' })).toBeTruthy();
  expect(view.queryByText(NEW_HEADING)).toBeNull();
  linkPages = [[LINK]];
  await fireEvent.press(view.getByRole('button', { name: 'Retry wallet links' }));
  expect(await view.findByText(NEW_HEADING)).toBeTruthy();
});

it('keeps every page under the session it was read for and shows a later session only its own links', async () => {
  const late = deferred();
  linkAnswers.set(1, () => late.promise);
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await waitFor(() => expect(requests(LINKS)).toHaveLength(1));
  const epoch = sessionScope.getSessionEpoch();
  const [first] = requests(LINKS);
  linkAnswers.clear();
  await act(() => sessionScope.invalidateSessionScope());
  expect(first.signal.aborted).toBe(true);
  await act(async () => late.resolve(page([{ ...LINK, uuid: 'link-retired' }], 'https://api.example.test/?page=2')));
  expect(await view.findByText(NEW_HEADING)).toBeTruthy();
  expect(view.getAllByText(NEW_HEADING)).toHaveLength(1);
  const retired = requests(LINKS).filter(({ ledovaSessionEpoch }) => ledovaSessionEpoch === epoch);
  expect(retired.every(({ signal }) => signal.aborted)).toBe(true);
  expect(
    requests(LINKS)
      .filter(({ ledovaSessionEpoch }) => ledovaSessionEpoch !== epoch)
      .map(({ ledovaSessionEpoch, params }) => [ledovaSessionEpoch, params.page]),
  ).toEqual([
    [epoch + 1, 1],
    [epoch + 1, 2],
  ]);
});

it('keeps a link answer that arrives after the session changes off the screen, even before it gives way', async () => {
  jest.spyOn(sessionScope, 'subscribeSession').mockReturnValue(() => {});
  const links = deferred();
  linkAnswers.set(1, () => links.promise);
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await waitFor(() => expect(reads(LINKS)).toBe(1));
  sessionScope.invalidateSessionScope();
  await act(async () => links.resolve(paged(linkPages, 1)));
  expect(await section(view).findByText('The wallet links could not be loaded.')).toBeTruthy();
  expect(view.queryByText(NEW_HEADING)).toBeNull();
});

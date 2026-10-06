import React from 'react';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  formatDate,
  formatDateTime,
  REGISTER_CORRECTION_COPY,
  REGISTER_PARTICULARS_COPY as COPY,
  type RegisterDecisionKind,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
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
const KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const CHANGES = URLS.REGISTER_PARTICULARS_CHANGES;
const ENTRIES_URL = URLS.REGISTER_ENTRIES('ordinary');
const DIGEST = 'a'.repeat(64);
const MEMBER_A = '10000000-0000-4000-8000-0000000000aa';
const MEMBER_GONE = '10000000-0000-4000-8000-0000000000bb';
const ADDRESS = '8 Synthetic Street, Melbourne VIC 3000';
const OLD_ADDRESS = '1 Synthetic Road, Sydney NSW 2000';
const KEY = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const NEW_HEADING = `${COPY.STAGES.submitted} · Alex Member`;
const REJECTED_HEADING = `${COPY.STAGES.rejected} · ${COPY.UNNAMED_MEMBER}`;
const NEW = `${COPY.STAGES.submitted.toLowerCase()} particulars change for Alex Member, as at ${formatDate('2026-09-20')}, prepared on ${formatDateTime('2026-10-05T01:00:00Z')}`;
const REJECTED_ONE = `${COPY.STAGES.rejected.toLowerCase()} particulars change for ${COPY.UNNAMED_MEMBER}, as at ${formatDate('2026-08-01')}, prepared on ${formatDateTime('2026-10-04T01:00:00Z')}`;
const CHANGE_ALEX = `${COPY.PREPARE} for Alex Member in Ordinary shares`;
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
    decidedAt: '2026-10-05T05:00:00Z',
    decidedBy: 1,
    decidedByName: name,
  };
}

const CHANGE = {
  uuid: 'change-new',
  company: 'paper',
  member: MEMBER_A,
  name: 'Alexandra Member',
  residentialAddress: ADDRESS,
  asAt: '2026-09-20',
  reason: 'Changed name by deed poll and moved',
  evidenceFingerprint: 'd'.repeat(64),
  evidenceSnapshot: {},
  supportingEvidence: 'evidence-supporting',
  preparingAppointment: 'appointment-prepare',
  preparedByName: 'Pat Preparer',
  providedBy: 'company',
  submittedBy: 1,
  status: 'submitted',
  stage: 'submitted',
  reviewedBy: null,
  reviewedAt: null as string | null,
  rejectionReason: '',
  decisions: [] as unknown[],
  createdAt: '2026-10-05T01:00:00Z',
};
const REJECTED = {
  ...CHANGE,
  uuid: 'change-rejected',
  member: MEMBER_GONE,
  name: 'Blair Member',
  residentialAddress: '2 Synthetic Lane, Hobart TAS 7000',
  asAt: '2026-08-01',
  reason: 'Moved house',
  preparedByName: 'Casey Preparer',
  status: 'rejected',
  stage: 'rejected',
  reviewedAt: '2026-10-04T03:00:00Z',
  rejectionReason: 'The notice is unsigned',
  decisions: [
    { ...decision('approve', 'key-approved', { name: 'Robin Approver' }), decidedAt: '2026-10-04T02:00:00Z' },
    { ...decision('reject', 'key-rejected', { reason: 'The notice is unsigned' }), decidedAt: '2026-10-04T03:00:00Z' },
  ],
  createdAt: '2026-10-04T01:00:00Z',
};
const PREVIEW = {
  previewDigest: DIGEST,
  unmetRequirements: [] as string[],
  canDecide: true,
  member: MEMBER_A,
  name: 'Alexandra Member',
  residentialAddress: ADDRESS,
  asAt: '2026-09-20',
  current: {
    name: 'Alex Member',
    residentialAddress: OLD_ADDRESS,
    asAt: '2026-01-15',
    sourceImport: 'import-1',
    sourceChange: null,
  } as object | null,
};
const PDF = { data: new Uint8Array([37, 80, 68, 70]).buffer, headers: { 'content-type': 'application/pdf' } };
let client: QueryClient;
let changePages: unknown[][];
let changeAnswers: Map<number, () => Promise<unknown>>;
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

function decided(kind: RegisterDecisionKind, key: string) {
  const recorded = decision(kind, key);
  return {
    ...CHANGE,
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
  get.mock.calls
    .filter(([called]) => called === url)
    .map(([, config]) => config as { params: Params; ledovaSessionEpoch: number; signal: AbortSignal });
const refreshed = () => [reads(CHANGES), reads(URLS.HOLDERS('ordinary')), reads(ENTRIES_URL), reads(APPOINTMENTS)];
const headings = (view: Awaited<ReturnType<typeof render>>) =>
  view.getAllByText(/^(Prepared|Approved|Applied|Rejected) · /).map(text);
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
  changePages = [[REJECTED], [CHANGE, REJECTED]];
  changeAnswers = new Map();
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
    if (url === URLS.HOLDERS('ordinary')) return { data: register };
    if (url === URLS.REGISTER_OPENINGS || url === URLS.REGISTER_IMPORTS || url === URLS.REGISTER_CORRECTIONS)
      return page([]);
    if (url === URLS.REGISTER_RECONCILIATIONS || url === ENTRIES_URL) return page([]);
    if (url === APPOINTMENTS) return page(appointments);
    if (url === CHANGES) return changeAnswers.get(number)?.() ?? paged(changePages, number);
    if (url === URLS.REGISTER_PARTICULARS_CHANGE_FILE('change-new')) return PDF;
    throw new Error(`Unexpected ${url}`);
  });
  jest.mocked(Sharing.shareAsync).mockClear();
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

it('reads every page of the company’s changes and lists each once, newest first, under the member’s register name', async () => {
  appointments = [appointment('appointment-reader', ['read_register'])];
  const view = await openRegister();
  const epoch = getSessionEpoch();
  const session = { ledovaSessionEpoch: epoch, signal: expect.objectContaining({ aborted: false }) };
  expect(requests(CHANGES)).toEqual([
    { ...session, params: { company: 'paper', page: 1 } },
    { ...session, params: { company: 'paper', page: 2 } },
  ]);
  expect(headings(view)).toEqual([NEW_HEADING, REJECTED_HEADING]);
  const record = within(view.getByText(NEW_HEADING).parent!);
  for (const shown of [
    COPY.PROVIDED_BY_COMPANY,
    'Alexandra Member',
    ADDRESS,
    formatDate('2026-09-20'),
    'Changed name by deed poll and moved',
    'Pat Preparer',
    formatDateTime(CHANGE.createdAt),
  ])
    expect(record.getByText(shown)).toBeTruthy();
  const rejected = within(view.getByText(REJECTED_HEADING).parent!);
  const trail = (label: string) => within(rejected.getByText(label).parent!);
  expect(
    trail(COPY.STAGES.approved).getByText(`Robin Approver · ${formatDateTime('2026-10-04T02:00:00Z')}`),
  ).toBeTruthy();
  expect(trail(COPY.STAGES.rejected).getByText(`Ari Admin · ${formatDateTime('2026-10-04T03:00:00Z')}`)).toBeTruthy();
  expect(rejected.getByText('The notice is unsigned')).toBeTruthy();
  expect(section(view).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: `${COPY.DOWNLOAD} of the ${NEW}` }));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(`${cache}ledova-document-views-v1/supporting-change-new.pdf`, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
    }),
  );
  expect(get).toHaveBeenCalledWith(URLS.REGISTER_PARTICULARS_CHANGE_FILE('change-new'), {
    responseType: 'arraybuffer',
    ledovaSessionEpoch: epoch,
  });
  expect(view.getByRole('button', { name: `${COPY.DOWNLOAD} of the ${REJECTED_ONE}` })).toBeTruthy();
  const names = view
    .getAllByRole('button')
    .map((button) => String(button.props.accessibilityLabel ?? ''))
    .filter(Boolean);
  expect(names.filter((name) => /change-|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name))).toEqual([]);
});

it.each([
  [
    'approval and rejection to an approver',
    [appointment('appointment-step', ['approve'])],
    ['approve', 'reject'],
    false,
  ],
  ['application to an appointee who applies', [appointment('appointment-step', ['apply'])], ['apply'], false],
  ['every step to an administrator', [appointment('appointment-step', ['admin'])], KINDS, true],
  ['only preparation to a preparer', [appointment('appointment-step', ['prepare'])], [], true],
  ['nothing to a register reader', [appointment('appointment-step', ['read_register'])], [], false],
  [
    'nothing to another company’s administrator',
    [appointment('appointment-step', ['admin'], { company: 'garden' })],
    [],
    false,
  ],
])('offers %s', async (_, own, offered, prepares) => {
  appointments = own;
  const view = await openRegister();
  await openClass(view);
  for (const kind of KINDS) {
    expect(!!view.queryByRole('button', { name: step(kind) })).toBe(offered.includes(kind));
    expect(view.queryByRole('button', { name: step(kind, REJECTED_ONE) })).toBeNull();
  }
  expect(!!view.queryByRole('button', { name: CHANGE_ALEX })).toBe(prepares);
  if (prepares) {
    await fireEvent.press(view.getByRole('button', { name: CHANGE_ALEX }));
    expect(mockNavigate).toHaveBeenCalledWith('PrepareRegisterParticulars', {
      tokenUuid: 'ordinary',
      companyUuid: 'paper',
      memberUuid: MEMBER_A,
    });
  }
});

it('reads the changes and appointments again on a pull to refresh', async () => {
  const view = await openRegister();
  expect(view.getByRole('button', { name: step('approve') })).toBeTruthy();
  appointments = [appointment('appointment-admin', ['admin'], { isEffective: false, status: 'revoked' })];
  changePages = [[{ ...CHANGE, uuid: 'change-later', createdAt: '2026-10-05T09:00:00Z' }, CHANGE]];
  await act(() => view.getByTestId('register-screen').props.refreshControl.props.onRefresh());
  await waitFor(() => expect(view.getAllByText(NEW_HEADING)).toHaveLength(2));
  expect(view.queryByText(REJECTED_HEADING)).toBeNull();
  expect(view.queryByRole('button', { name: step('approve') })).toBeNull();
  expect(section(view).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('refuses changes that name another company, and reads them again on request', async () => {
  changePages = [[CHANGE, { ...REJECTED, company: 'garden' }]];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  expect(await view.findByRole('button', { name: 'Retry particulars changes' })).toBeTruthy();
  expect(view.queryByText(NEW_HEADING)).toBeNull();
  changePages = [[CHANGE]];
  await fireEvent.press(view.getByRole('button', { name: 'Retry particulars changes' }));
  expect(await view.findByText(NEW_HEADING)).toBeTruthy();
});

it('previews an approval with the current particulars beside the proposal, records it and refreshes', async () => {
  post.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: decided('approve', KEY(1)) });
  const view = await openRegister();
  await openClass(view);
  const epoch = getSessionEpoch();
  const before = refreshed();
  await fireEvent.press(view.getByRole('button', { name: step('approve') }));
  expect(await view.findByText(COPY.CONFIRMATIONS.approve)).toBeTruthy();
  expect(post).toHaveBeenCalledWith(
    URLS.REGISTER_PARTICULARS_CHANGE_PREVIEW('change-new'),
    { appointment: 'appointment-admin', kind: 'approve', reason: '' },
    { ledovaSessionEpoch: epoch },
  );
  expect(view.getByText(COPY.PRECEDENCE_NOTE)).toBeTruthy();
  expect(view.getByText(COPY.CURRENT_PARTICULARS)).toBeTruthy();
  expect(view.getByText(OLD_ADDRESS)).toBeTruthy();
  expect(view.getByText(formatDate('2026-01-15'))).toBeTruthy();
  expect(view.getByText(COPY.PROPOSED_PARTICULARS)).toBeTruthy();
  expect(view.getAllByText(ADDRESS)).toHaveLength(2);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_PARTICULARS_CHANGE_DECIDE('change-new'),
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

it('refreshes after a refused decision and withdraws the steps an appointment no longer holds', async () => {
  post.mockResolvedValueOnce({ data: { ...PREVIEW, current: null } }).mockRejectedValueOnce({
    message: 'Request failed with status code 400',
    response: { status: 400, data: { unmetRequirements: ['appointment_capability_required'] } },
  });
  const view = await openRegister();
  await openClass(view);
  expect(view.getByRole('button', { name: CHANGE_ALEX })).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: step('apply') }));
  expect(await view.findByText(COPY.NO_CURRENT_PARTICULARS)).toBeTruthy();
  const before = refreshed();
  appointments = [appointment('appointment-admin', ['admin'], { isEffective: false, status: 'revoked' })];
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => refreshed().forEach((count, index) => expect(count).toBeGreaterThan(before[index])));
  await waitFor(() => expect(view.queryByRole('button', { name: step('apply') })).toBeNull());
  expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull();
  expect(view.queryByRole('button', { name: CHANGE_ALEX })).toBeNull();
  expect(section(view).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('asks for no further page once the session changes between pages, and reads again under the new session', async () => {
  const late = deferred();
  changeAnswers.set(1, () => late.promise);
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await waitFor(() => expect(requests(CHANGES)).toHaveLength(1));
  const epoch = getSessionEpoch();
  const [first] = requests(CHANGES);
  changeAnswers.clear();
  await act(() => invalidateSessionScope());
  expect(first.signal.aborted).toBe(true);
  await act(async () => late.resolve(paged(changePages, 1)));
  expect(await view.findByText(NEW_HEADING)).toBeTruthy();
  expect(requests(CHANGES).map(({ ledovaSessionEpoch, params }) => [ledovaSessionEpoch, params.page])).toEqual([
    [epoch, 1],
    [epoch + 1, 1],
    [epoch + 1, 2],
  ]);
});

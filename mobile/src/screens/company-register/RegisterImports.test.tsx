import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  formatDateTime,
  REGISTER_COPY,
  REGISTER_CORRECTION_COPY,
  REGISTER_IMPORT_COPY as COPY,
  REGISTER_IMPORT_UNMET_COPY,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { cache, resetFiles } from '../../testSupport/documentFiles';
import { CompanyRegisterScreen } from './CompanyRegisterScreen';
import { importsKey } from './useCompanyRegister';

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
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const ENTRIES_URL = URLS.REGISTER_ENTRIES('ordinary');
const DIGEST = 'a'.repeat(64);
const NEW = 'prepared import as at 20 September 2026';
const OLD = 'rejected import as at 1 September 2026';
const KEY = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const step = (kind: string, description = NEW) => `${kind} the ${description}`;
const copyOf = (label: string, description = NEW) => `${label} of the ${description}`;
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
const ROW = {
  name: 'Alex Member',
  member: 'member-1',
  shares: '100',
  enteredOn: '2019-05-01',
  amountPaid: '250.00',
  residentialAddress: '1 Synthetic Street',
};
const submitted = {
  uuid: 'import-new',
  company: 'paper',
  token: 'ordinary',
  status: 'submitted',
  stage: 'submitted',
  providedBy: 'company',
  preparedByName: 'Pat Preparer',
  preparingAppointment: 'appointment-prepare',
  asAt: '2026-09-20',
  asicIssuedTotal: '9007199254740993',
  asicMemberCount: 1,
  asicSnapshot: { providedBy: 'company' },
  members: [{ ...ROW, shares: '9007199254740993' }],
  formerMembers: [],
  decisions: [] as unknown[],
  rejectionReason: '',
  reviewedAt: null as string | null,
  createdAt: '2026-10-02T01:00:00Z',
};
const retired = {
  ...submitted,
  uuid: 'import-old',
  status: 'rejected',
  stage: 'rejected',
  providedBy: 'staff_verified',
  preparedByName: null,
  preparingAppointment: null,
  asAt: '2026-09-01',
  asicIssuedTotal: null,
  asicMemberCount: null,
  asicSnapshot: null,
  members: [ROW],
  rejectionReason: 'Superseded by a company import',
  reviewedAt: '2026-10-01T02:00:00Z',
  createdAt: '2026-10-02T09:00:00+10:00',
  decisions: [
    {
      uuid: 'decision-old',
      kind: 'reject',
      appointment: 'appointment-admin',
      idempotencyKey: 'key-old',
      digest: DIGEST,
      reason: 'Superseded by a company import',
      decidedAt: '2026-10-01T02:00:00Z',
      decidedBy: 2,
      decidedByName: 'Robin Reviewer',
    },
  ],
};
const PREVIEW = {
  previewDigest: DIGEST,
  unmetRequirements: [] as string[],
  canDecide: true,
  opensRegister: false,
  registerSequence: 1,
  comparison: [
    {
      member: 'member-1',
      name: 'Alex Member' as string | null,
      imported: '100' as string | null,
      stored: '100' as string | null,
      enteredOn: '2026-09-01' as string | null,
      importedEnteredOn: '2019-05-01' as string | null,
      wallets: [`0x${'1'.repeat(40)}`],
      liveName: 'Alex Live' as string | null,
      liveAddress: '1 Live Street' as string | null,
    },
  ],
  statedTotal: '9007199254740993',
  statedMemberCount: 1,
  importedTotal: '9007199254740993',
  importedMemberCount: 1,
};
const UNREASONED = { ...PREVIEW, canDecide: false, unmetRequirements: ['reason_required'] };
const OPENING = {
  uuid: 'entry-1',
  sequence: 1,
  kind: 'opening',
  effectiveOn: '2026-09-20',
  recordedAt: '2026-10-05T00:00:00Z',
  changes: [{ member: 'member-1', name: 'Alex Member', shares: '100' }],
  corrects: null,
  correctedBy: null,
  correctable: true,
};
let client: QueryClient;
let importPages: unknown[][];
let entryRows: unknown[];
let appointments: unknown[];
let importsFail: boolean;
let appointmentsFail: boolean;
let held: Set<string>;
let fileAnswer: Promise<unknown> | null;

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
  const decision = {
    uuid: `decision-${key}`,
    kind,
    appointment,
    idempotencyKey: key,
    digest: DIGEST,
    reason,
    decidedAt: '2026-10-05T00:00:00Z',
    decidedBy: 1,
    decidedByName: 'Ari Admin',
  };
  return {
    ...submitted,
    status: kind === 'approve' ? 'submitted' : kind === 'apply' ? 'applied' : 'rejected',
    stage: kind === 'approve' ? 'approved' : kind === 'apply' ? 'applied' : 'rejected',
    reviewedAt: kind === 'approve' ? null : decision.decidedAt,
    rejectionReason: kind === 'reject' ? reason : '',
    decisions: [decision],
  };
}

const page = (results: unknown[], next: string | null = null) => ({ data: { results, next, count: results.length } });
const reads = (url: string) => get.mock.calls.filter(([called]) => called === url).length;
const PDF = { data: new Uint8Array([37, 80, 68, 70]).buffer, headers: { 'content-type': 'application/pdf' } };
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
  await view.findByText('Prepared · as at 20 September 2026');
  return view;
}

beforeEach(() => {
  resetFiles();
  importPages = [[retired], [submitted]];
  entryRows = [];
  appointments = [appointment('appointment-admin', ['admin'])];
  importsFail = false;
  appointmentsFail = false;
  held = new Set();
  fileAnswer = null;
  let keys = 0;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => KEY(++keys) as ReturnType<typeof Crypto.randomUUID>);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
  });
  post.mockReset();
  get.mockReset().mockImplementation(async (url, config) => {
    const number = (config?.params as { page?: number } | undefined)?.page ?? 1;
    if (held.has(url)) return new Promise(() => {}) as ReturnType<typeof get>;
    if (url === URLS.REGISTER) return page([shareClass]);
    if (url === URLS.HOLDERS('ordinary')) return { data: register };
    if (url === URLS.REGISTER_IMPORTS) {
      if (importsFail) throw new Error('Imports unavailable');
      return page(
        importPages[number - 1] ?? [],
        number < importPages.length ? `https://api.example.test/?page=${number + 1}` : null,
      );
    }
    if (url === APPOINTMENTS) {
      if (appointmentsFail) throw new Error('Appointments unavailable');
      return page(appointments);
    }
    if (url === ENTRIES_URL) return page(entryRows);
    if (url === URLS.REGISTER_CORRECTIONS || url === URLS.REGISTER_RECONCILIATIONS) return page([]);
    if (url === URLS.REGISTER_IMPORT_FILE('import-new')) return fileAnswer ?? PDF;
    if (url === URLS.REGISTER_IMPORT_ASIC_FILE('import-new')) return PDF;
    throw new Error(`Unexpected ${url}`);
  });
  jest.mocked(Sharing.shareAsync).mockClear();
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

it('reads every page of a class import history newest first and shares its retained copies', async () => {
  appointments = [appointment('appointment-reader', ['read_register'])];
  const view = await openClass();
  const epoch = getSessionEpoch();
  const session = { ledovaSessionEpoch: epoch, signal: expect.objectContaining({ aborted: false }) };
  expect(get.mock.calls.filter(([url]) => url === URLS.REGISTER_IMPORTS).map(([, config]) => config)).toEqual([
    { ...session, params: { token: 'ordinary', page: 1 } },
    { ...session, params: { token: 'ordinary', page: 2 } },
  ]);
  expect(get).toHaveBeenCalledWith(APPOINTMENTS, { ...session, params: { page: 1 } });
  expect(view.getAllByText(/ · as at /).map((heading) => heading.props.children.join(''))).toEqual([
    'Prepared · as at 20 September 2026',
    'Rejected · as at 1 September 2026',
  ]);
  expect(view.getByText(COPY.PROVIDED_BY_COMPANY)).toBeTruthy();
  expect(view.getByText(COPY.STAFF_VERIFIED)).toBeTruthy();
  expect(view.getByText('Pat Preparer')).toBeTruthy();
  expect(view.getByText(formatDateTime(submitted.createdAt))).toBeTruthy();
  expect(view.getByText(COPY.STATED_FIGURES('9,007,199,254,740,993', 1))).toBeTruthy();
  expect(view.getByText(COPY.IMPORTED_FIGURES('9,007,199,254,740,993', 1))).toBeTruthy();
  expect(view.getByText(COPY.IMPORTED_FIGURES('100', 1))).toBeTruthy();
  expect(view.getByText(`Robin Reviewer · ${formatDateTime('2026-10-01T02:00:00Z')}`)).toBeTruthy();
  expect(view.getByText('Superseded by a company import')).toBeTruthy();
  expect(view.queryByText('Decided on')).toBeNull();
  expect(view.getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: copyOf(COPY.DOWNLOAD_REGISTER) }));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(`${cache}ledova-document-views-v1/register-import-new.pdf`, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
    }),
  );
  expect(get).toHaveBeenCalledWith(URLS.REGISTER_IMPORT_FILE('import-new'), {
    responseType: 'arraybuffer',
    ledovaSessionEpoch: epoch,
  });
  await fireEvent.press(view.getByRole('button', { name: copyOf(COPY.DOWNLOAD_ASIC) }));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenLastCalledWith(
      `${cache}ledova-document-views-v1/asic-extract-import-new.pdf`,
      { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' },
    ),
  );
  expect(get).toHaveBeenCalledWith(URLS.REGISTER_IMPORT_ASIC_FILE('import-new'), {
    responseType: 'arraybuffer',
    ledovaSessionEpoch: epoch,
  });
  expect(view.getByRole('button', { name: copyOf(COPY.DOWNLOAD_REGISTER, OLD) })).toBeTruthy();
  expect(view.queryByRole('button', { name: copyOf(COPY.DOWNLOAD_ASIC, OLD) })).toBeNull();
});

it('shows a decision without a recorded decider name by its time alone', async () => {
  importPages = [[{ ...retired, decisions: [{ ...retired.decisions[0], decidedByName: '' }] }], [submitted]];
  const view = await openClass();
  expect(view.getByText(formatDateTime('2026-10-01T02:00:00Z'))).toBeTruthy();
  expect(view.queryByText(` · ${formatDateTime('2026-10-01T02:00:00Z')}`)).toBeNull();
});

it('dates a decided staff-era import that has no decision trail', async () => {
  importPages = [[{ ...retired, decisions: [] }], [submitted]];
  const view = await openClass();
  expect(view.getAllByText('Decided on')).toHaveLength(1);
  expect(view.getByText(formatDateTime(retired.reviewedAt))).toBeTruthy();
});

it.each([
  ['a register reader', [appointment('appointment-reader', ['read_register'])]],
  ['an expired administrator', [appointment('appointment-expired', ['admin'], { isEffective: false })]],
  ['another company administrator', [appointment('appointment-other', ['admin'], { company: 'garden' })]],
])('shows %s the history with the read-only note and no import action', async (_, own) => {
  appointments = own;
  const view = await openClass();
  expect(view.getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  for (const kind of ['Approve', 'Apply', 'Reject'])
    expect(view.queryByRole('button', { name: step(kind) })).toBeNull();
  expect(view.queryByRole('button', { name: `${COPY.PREPARE} for Ordinary shares` })).toBeNull();
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
    expect(view.queryByRole('button', { name: step(kind, OLD) })).toBeNull();
  }
  expect(!!view.queryByRole('button', { name: `${COPY.PREPARE} for Ordinary shares` })).toBe(prepares);
  expect(view.queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
});

it('offers a retained staff-era import only rejection, beside a company import that offers every step', async () => {
  const waiting = { ...retired, uuid: 'import-staff', status: 'submitted', stage: 'submitted', decisions: [] };
  importPages = [[{ ...waiting, rejectionReason: '', reviewedAt: null }], [submitted]];
  const staff = 'prepared import as at 1 September 2026';
  const view = await openClass();
  expect(view.getByText('Prepared · as at 1 September 2026')).toBeTruthy();
  expect(view.getByRole('button', { name: step('Reject', staff) })).toBeTruthy();
  expect(view.queryByRole('button', { name: step('Approve', staff) })).toBeNull();
  expect(view.queryByRole('button', { name: step('Apply', staff) })).toBeNull();
  for (const kind of ['Approve', 'Apply', 'Reject'])
    expect(view.getByRole('button', { name: step(kind) })).toBeTruthy();
});

it('lists an import once when the next page repeats it after a newer import was prepared', async () => {
  importPages = [[submitted], [submitted, retired]];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  await view.findByText('Rejected · as at 1 September 2026');
  expect(view.getAllByText(/ · as at /).map((heading) => heading.props.children.join(''))).toEqual([
    'Prepared · as at 20 September 2026',
    'Rejected · as at 1 September 2026',
  ]);
  expect(view.getAllByRole('button', { name: step('Approve') })).toHaveLength(1);
});

it('opens preparation for the class and withdraws it once the class has an applied import', async () => {
  appointments = [appointment('appointment-prepare', ['prepare'])];
  const view = await openClass();
  await fireEvent.press(view.getByRole('button', { name: `${COPY.PREPARE} for Ordinary shares` }));
  expect(mockNavigate).toHaveBeenCalledWith('PrepareRegisterImport', { tokenUuid: 'ordinary', companyUuid: 'paper' });
  importPages = [[decided('apply', 'key-applied')]];
  await act(() => view.getByTestId('register-screen').props.refreshControl.props.onRefresh());
  await view.findByText('Applied · as at 20 September 2026');
  expect(view.queryByRole('button', { name: `${COPY.PREPARE} for Ordinary shares` })).toBeNull();
});

it('withdraws every import step once a pull to refresh reads the appointment as revoked', async () => {
  const view = await openClass();
  expect(view.getByRole('button', { name: step('Approve') })).toBeTruthy();
  appointments = [revoked('appointment-admin', ['admin'])];
  await act(() => view.getByTestId('register-screen').props.refreshControl.props.onRefresh());
  await waitFor(() => expect(view.queryByRole('button', { name: step('Approve') })).toBeNull());
  expect(view.queryByRole('button', { name: `${COPY.PREPARE} for Ordinary shares` })).toBeNull();
  expect(view.getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('previews an approval, records exactly that decision and refetches the class imports and holders', async () => {
  post.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: decided('approve', KEY(1)) });
  const view = await openClass();
  const epoch = getSessionEpoch();
  const before = [reads(URLS.REGISTER_IMPORTS), reads(URLS.HOLDERS('ordinary'))];
  await fireEvent.press(view.getByRole('button', { name: step('Approve') }));
  expect(await view.findByText(COPY.CONFIRMATIONS.approve)).toBeTruthy();
  expect(post).toHaveBeenCalledWith(
    URLS.REGISTER_IMPORT_PREVIEW('import-new'),
    { appointment: 'appointment-admin', kind: 'approve', reason: '' },
    { ledovaSessionEpoch: epoch },
  );
  expect(view.getAllByText(COPY.STATED_FIGURES('9,007,199,254,740,993', 1))).toHaveLength(2);
  expect(view.getAllByText(COPY.IMPORTED_FIGURES('9,007,199,254,740,993', 1))).toHaveLength(2);
  expect(view.getByText('Live name')).toBeTruthy();
  expect(view.getByText('Alex Live')).toBeTruthy();
  expect(view.getByText('Live address')).toBeTruthy();
  expect(view.getByText('1 Live Street')).toBeTruthy();
  expect(view.getByText(`0x${'1'.repeat(40)}`)).toBeTruthy();
  expect(view.queryByText(/verified identity/i)).toBeNull();
  expect(view.queryByText(COPY.NOT_ON_CHAIN_NOTE)).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_IMPORT_DECIDE('import-new'),
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
  await waitFor(() => expect(reads(URLS.REGISTER_IMPORTS)).toBeGreaterThan(before[0]));
  expect(reads(URLS.HOLDERS('ordinary'))).toBeGreaterThan(before[1]);
});

it('shows the opening entry an applied import records without a pull to refresh', async () => {
  post
    .mockResolvedValueOnce({ data: { ...PREVIEW, opensRegister: true } })
    .mockResolvedValueOnce({ data: decided('apply', KEY(1)) });
  const view = await openClass();
  expect(await view.findByText(REGISTER_CORRECTION_COPY.ENTRIES_EMPTY)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: step('Apply') }));
  await view.findByText(COPY.CONFIRMATIONS.apply);
  importPages = [[retired], [decided('apply', KEY(1))]];
  entryRows = [OPENING];
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(await view.findByText('Entry 1 · Opening state')).toBeTruthy();
  expect(view.queryByText(REGISTER_CORRECTION_COPY.ENTRIES_EMPTY)).toBeNull();
  expect(await view.findByText('Applied · as at 20 September 2026')).toBeTruthy();
});

it('labels a member without a live identity neutrally in the comparison', async () => {
  post.mockResolvedValueOnce({
    data: {
      ...PREVIEW,
      comparison: [{ ...PREVIEW.comparison[0], name: null, imported: null, wallets: [], liveName: '' }],
    },
  });
  const view = await openClass();
  const listed = view.queryAllByText(REGISTER_COPY.NO_WALLET).length;
  await fireEvent.press(view.getByRole('button', { name: step('Approve') }));
  await view.findByText(COPY.CONFIRMATIONS.approve);
  expect(view.getByText('No live identity')).toBeTruthy();
  expect(view.getAllByText('Not in the import')).toHaveLength(2);
  expect(view.getAllByText(REGISTER_COPY.NO_WALLET)).toHaveLength(listed + 1);
  expect(view.queryByText(/verified identity/i)).toBeNull();
});

it('notes that applying an opening import leaves the class off chain, and unmet requirements block it', async () => {
  const opening = {
    ...PREVIEW,
    opensRegister: true,
    comparison: [{ ...PREVIEW.comparison[0], stored: null, enteredOn: null }],
  };
  post
    .mockResolvedValueOnce({
      data: { ...opening, canDecide: false, unmetRequirements: ['approval_required', 'future_requirement'] },
    })
    .mockResolvedValueOnce({ data: opening });
  const view = await openClass();
  await fireEvent.press(view.getByRole('button', { name: step('Apply') }));
  expect(await view.findByText(COPY.NOT_ON_CHAIN_NOTE)).toBeTruthy();
  expect(view.getByText(REGISTER_IMPORT_UNMET_COPY.approval_required)).toBeTruthy();
  expect(view.getByText('future_requirement')).toBeTruthy();
  expect(view.getByText(COPY.CONFIRMATIONS.apply)).toBeTruthy();
  expect(view.getAllByText('Not stored')).toHaveLength(2);
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(post).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  await fireEvent.press(view.getByRole('button', { name: step('Approve') }));
  expect(await view.findByText(COPY.CONFIRMATIONS.approve)).toBeTruthy();
  expect(view.queryByText(COPY.NOT_ON_CHAIN_NOTE)).toBeNull();
});

it('rejects only with the reason it previewed, trimmed and at most 1,000 characters', async () => {
  appointments = [appointment('appointment-approver', ['approve'])];
  const rejection = { appointment: 'appointment-approver', reason: 'Stale register' };
  post
    .mockResolvedValueOnce({ data: UNREASONED })
    .mockResolvedValueOnce({ data: PREVIEW })
    .mockResolvedValueOnce({ data: decided('reject', KEY(2), rejection) });
  const view = await openClass();
  const epoch = getSessionEpoch();
  await fireEvent.press(view.getByRole('button', { name: step('Reject') }));
  expect(await view.findByText(REGISTER_IMPORT_UNMET_COPY.reason_required)).toBeTruthy();
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_IMPORT_PREVIEW('import-new'),
    { appointment: 'appointment-approver', kind: 'reject', reason: '' },
    { ledovaSessionEpoch: epoch },
  );
  const reason = () => view.getByLabelText(COPY.REJECTION_REASON);
  expect(reason().props.maxLength).toBe(1000);
  expect(view.getByRole('button', { name: 'Preview rejection' })).toBeDisabled();
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await fireEvent.changeText(reason(), '  Stale register  ');
  await fireEvent.press(view.getByRole('button', { name: 'Preview rejection' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_IMPORT_PREVIEW('import-new'),
    { appointment: 'appointment-approver', kind: 'reject', reason: 'Stale register' },
    { ledovaSessionEpoch: epoch },
  );
  expect(view.getByRole('button', { name: 'Preview rejection' })).toBeDisabled();
  await fireEvent.changeText(reason(), 'Stale register, and late');
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  expect(view.getByRole('button', { name: 'Preview rejection' })).toBeEnabled();
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(post).toHaveBeenCalledTimes(2);
  await fireEvent.changeText(reason(), 'Stale register ');
  expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_IMPORT_DECIDE('import-new'),
    {
      appointment: 'appointment-approver',
      kind: 'reject',
      reason: 'Stale register',
      idempotencyKey: KEY(2),
      previewDigest: DIGEST,
      confirmation: true,
    },
    expect.objectContaining({ ledovaSessionEpoch: epoch }),
  );
});

it('clears the previous rejection error when the rejection reopens', async () => {
  post
    .mockResolvedValueOnce({ data: UNREASONED })
    .mockResolvedValueOnce({ data: PREVIEW })
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce({ data: UNREASONED });
  const view = await openClass();
  await fireEvent.press(view.getByRole('button', { name: step('Reject') }));
  await view.findByText(REGISTER_IMPORT_UNMET_COPY.reason_required);
  await fireEvent.changeText(view.getByLabelText(COPY.REJECTION_REASON), 'Stale register');
  await fireEvent.press(view.getByRole('button', { name: 'Preview rejection' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(await view.findByText('Network Error')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  await fireEvent.press(view.getByRole('button', { name: step('Reject') }));
  expect(await view.findByText(REGISTER_IMPORT_UNMET_COPY.reason_required)).toBeTruthy();
  expect(view.getByLabelText(COPY.REJECTION_REASON).props.value).toBe('');
  expect(view.queryByText('Network Error')).toBeNull();
});

it('refetches the class imports, entries, holders and appointments when a decision is refused', async () => {
  post.mockResolvedValueOnce({ data: PREVIEW }).mockRejectedValueOnce({
    response: {
      status: 409,
      data: { detail: 'The register operation conflicts with its recorded identity or holdings.' },
    },
  });
  const view = await openClass();
  await fireEvent.press(view.getByRole('button', { name: step('Apply') }));
  await view.findByText(COPY.CONFIRMATIONS.apply);
  const before = [
    reads(URLS.REGISTER_IMPORTS),
    reads(URLS.HOLDERS('ordinary')),
    reads(APPOINTMENTS),
    reads(ENTRIES_URL),
  ];
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(
    await view.findByText('The register operation conflicts with its recorded identity or holdings.'),
  ).toBeTruthy();
  await waitFor(() => expect(reads(URLS.REGISTER_IMPORTS)).toBeGreaterThan(before[0]));
  expect(reads(URLS.HOLDERS('ordinary'))).toBeGreaterThan(before[1]);
  await waitFor(() => expect(reads(APPOINTMENTS)).toBeGreaterThan(before[2]));
  expect(reads(ENTRIES_URL)).toBeGreaterThan(before[3]);
  expect(view.queryByText(COPY.CONFIRMATIONS.apply)).toBeNull();
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
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
  expect(view.queryByText('Request failed with status code 400')).toBeNull();
  expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull();
  expect(view.getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('reads the appointments again after a refused preview and withdraws the revoked steps', async () => {
  post.mockRejectedValueOnce({ response: { status: 404, data: { detail: 'Appointment not found.' } } });
  const view = await openClass();
  const before = reads(APPOINTMENTS);
  appointments = [revoked('appointment-admin', ['admin'])];
  await fireEvent.press(view.getByRole('button', { name: step('Approve') }));
  await waitFor(() => expect(reads(APPOINTMENTS)).toBeGreaterThan(before));
  await waitFor(() => expect(view.queryByRole('button', { name: step('Approve') })).toBeNull());
  expect(view.queryByRole('button', { name: step('Reject') })).toBeNull();
  expect(view.getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
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

it('leaves the cached history unchanged when a decision receipt cannot be confirmed', async () => {
  post.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: decided('approve', 'another-key') });
  const view = await openClass();
  const key = importsKey(getSessionEpoch(), 'ordinary');
  await fireEvent.press(view.getByRole('button', { name: step('Approve') }));
  await view.findByText(COPY.CONFIRMATIONS.approve);
  const cached = client.getQueryState(key)!;
  const before = [reads(URLS.REGISTER_IMPORTS), reads(URLS.HOLDERS('ordinary'))];
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(await view.findByText(COPY.DECISION_RECEIPT_FAILED)).toBeTruthy();
  expect([reads(URLS.REGISTER_IMPORTS), reads(URLS.HOLDERS('ordinary'))]).toEqual(before);
  expect(client.getQueryState(key)).toEqual(cached);
});

it('retries an interrupted decision under its key, without rereading appointments, until the preview changes', async () => {
  post
    .mockResolvedValueOnce({ data: PREVIEW })
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce({ data: PREVIEW })
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce({ data: { ...PREVIEW, previewDigest: 'b'.repeat(64) } })
    .mockRejectedValueOnce(new Error('Network Error'));
  const view = await openClass();
  const appointmentReads = reads(APPOINTMENTS);
  const decide = () => post.mock.calls.filter(([url]) => url === URLS.REGISTER_IMPORT_DECIDE('import-new'));
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
  expect((decide()[2][1] as { previewDigest: string }).previewDigest).toBe('b'.repeat(64));
  expect(reads(APPOINTMENTS)).toBe(appointmentReads);
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
  expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull();
  const retired = get.mock.calls.length;
  await act(async () => late.resolve({ data: decided('apply', KEY(1)) }));
  expect(get.mock.calls.slice(retired).filter(([, config]) => config?.ledovaSessionEpoch === epoch)).toEqual([]);
  expect(client.getQueryState(importsKey(epoch, 'ordinary'))?.errorUpdateCount).toBe(0);
  expect(view.queryByText(COPY.DECISION_RECEIPT_FAILED)).toBeNull();
});

it('opens no share sheet for a retained copy answered after the session changes', async () => {
  const late = deferred();
  fileAnswer = late.promise;
  const view = await openClass();
  await fireEvent.press(view.getByRole('button', { name: copyOf(COPY.DOWNLOAD_REGISTER) }));
  await waitFor(() => expect(get).toHaveBeenCalledWith(URLS.REGISTER_IMPORT_FILE('import-new'), expect.anything()));
  await act(() => invalidateSessionScope());
  await act(async () => late.resolve(PDF));
  await view.findByRole('button', { name: 'Ordinary shares register' });
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

it('shows a new session no import history or step before its own imports answer', async () => {
  const view = await openClass();
  expect(view.getByRole('button', { name: step('Approve') })).toBeTruthy();
  held = new Set([URLS.REGISTER_IMPORTS, APPOINTMENTS]);
  await act(() => invalidateSessionScope());
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText('Loading imports…')).toBeTruthy();
  expect(view.queryByText('Prepared · as at 20 September 2026')).toBeNull();
  expect(view.queryByRole('button', { name: step('Approve') })).toBeNull();
});

it('offers a new session no import step before its own appointments answer', async () => {
  const view = await openClass();
  expect(view.getByRole('button', { name: step('Approve') })).toBeTruthy();
  held = new Set([APPOINTMENTS]);
  await act(() => invalidateSessionScope());
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  await view.findByText('Prepared · as at 20 September 2026');
  expect(view.queryByRole('button', { name: step('Approve') })).toBeNull();
  expect(view.queryByRole('button', { name: `${COPY.PREPARE} for Ordinary shares` })).toBeNull();
  expect(view.queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
});

it('hides a class history after a failed read and offers a retry', async () => {
  const view = await openClass();
  importsFail = true;
  await act(() => client.invalidateQueries({ queryKey: importsKey(getSessionEpoch()) }));
  expect(await view.findByText('The imports could not be loaded.')).toBeTruthy();
  expect(view.queryByText('Prepared · as at 20 September 2026')).toBeNull();
  expect(view.queryByRole('button', { name: step('Approve') })).toBeNull();
  importsFail = false;
  await fireEvent.press(view.getByRole('button', { name: 'Retry imports for Ordinary shares' }));
  expect(await view.findByText('Prepared · as at 20 September 2026')).toBeTruthy();
});

it('withholds register actions while the appointments cannot be read', async () => {
  appointmentsFail = true;
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText('Your appointments could not be read, so register actions are hidden.')).toBeTruthy();
  await view.findByText('Prepared · as at 20 September 2026');
  expect(view.queryByRole('button', { name: step('Approve') })).toBeNull();
  expect(view.queryByRole('button', { name: `${COPY.PREPARE} for Ordinary shares` })).toBeNull();
  expect(view.queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
  appointmentsFail = false;
  await fireEvent.press(view.getByRole('button', { name: 'Retry appointments for Ordinary shares' }));
  expect(await view.findByRole('button', { name: step('Approve') })).toBeTruthy();
});

it.each([
  ['another class', { token: 'preference' }],
  ['another company', { company: 'garden' }],
])('refuses an import history that names %s', async (_, foreign) => {
  importPages = [[retired], [{ ...submitted, ...foreign }]];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText('The imports could not be loaded.')).toBeTruthy();
  expect(view.queryByText('Rejected · as at 1 September 2026')).toBeNull();
  expect(view.queryByRole('button', { name: step('Approve') })).toBeNull();
});

it('keeps a decision open while its preview is answered', async () => {
  const late = deferred();
  post.mockReturnValueOnce(late.promise as ReturnType<typeof post>);
  const view = await openClass();
  await fireEvent.press(view.getByRole('button', { name: step('Approve') }));
  expect(await view.findByText('Previewing the decision…')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await fireEvent.press(view.getByTestId('modal-backdrop-Approve import'));
  expect(view.getByText('Previewing the decision…')).toBeTruthy();
  await act(async () => late.resolve({ data: PREVIEW }));
  expect(await view.findByText(COPY.CONFIRMATIONS.approve)).toBeTruthy();
  expect(view.getByRole('button', { name: 'Cancel' })).toBeEnabled();
});

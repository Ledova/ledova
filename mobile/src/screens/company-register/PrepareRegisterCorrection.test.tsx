import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_CORRECTION_COPY as COPY,
  type RegisterCorrectionPreparation,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { files, pickedFile, resetFiles } from '../../testSupport/documentFiles';
import { PrepareRegisterCorrectionScreen } from './PrepareRegisterCorrectionScreen';
import { correctionsKey } from './useCompanyRegister';

const mockGoBack = jest.fn();
let mockParams = { tokenUuid: 'ordinary', companyUuid: 'paper', entryUuid: 'entry-2' };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../services/tokenStorage', () => ({ getAccessToken: jest.fn(async () => 'synthetic-access') }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);

type Upload = [string, unknown];
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const FAILED = 'The correction could not be prepared. Retry with the same details.';
const LATE_DATE = 'Enter the effective date as YYYY-MM-DD, today (UTC) or earlier.';
const BIG = '9007199254740993';
const KEY = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const pick = jest.mocked(DocumentPicker.getDocumentAsync);
const register = {
  token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'deployed', totalSupply: '1000' },
  issuedSupply: '100',
  initialized: true,
  waitingEffects: 0,
  totalHolders: 0,
  holders: [],
};
const TRANSFER = {
  uuid: 'entry-2',
  sequence: 2,
  kind: 'transfer',
  effectiveOn: '2026-09-10',
  recordedAt: '2026-09-10T03:00:00Z',
  changes: [
    { member: 'member-1', name: 'Alex Member' as string | null, shares: `-${BIG}` },
    { member: 'member-2', name: 'Blair Member' as string | null, shares: BIG },
  ],
  corrects: null,
  correctedBy: null as string | null,
  correctable: true,
};
const OPENING = {
  ...TRANSFER,
  uuid: 'entry-1',
  sequence: 1,
  kind: 'opening',
  effectiveOn: '2026-09-01',
  changes: [{ member: 'member-1', name: null, shares: '40' }],
};
let client: QueryClient;
let lookupEntries: (typeof TRANSFER)[];
let appointments: unknown[];
let readsFail: boolean;
let held: Set<string>;
let lookupAnswer: (() => Promise<unknown>) | null;
let evidenceChanges: object[];
let prepareAnswer: jest.Mock;
let append: jest.SpyInstance<ReturnType<FormData['append']>, Parameters<FormData['append']>>;

function appointment(uuid: string, capabilities: string[]) {
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
  };
}

function parts(form: unknown) {
  return append.mock.calls
    .filter((_, index) => append.mock.contexts[index] === form)
    .map(([name, value]) => [name, value] as Upload);
}

function field(form: unknown, key: string) {
  return parts(form).find(([name]) => name === key)?.[1];
}

function evidenceFor(form: unknown) {
  return {
    uuid: 'evidence-authority',
    company: field(form, 'company_id'),
    appointment: field(form, 'appointment'),
    kind: field(form, 'kind'),
    idempotencyKey: field(form, 'idempotency_key'),
    originalFilename: (field(form, 'file') as { name: string }).name,
    fileSize: 5,
    mimeType: 'application/pdf',
    sha256: 'b'.repeat(64),
    providedBy: 'company',
    createdAt: '2026-10-05T00:00:00Z',
    ...evidenceChanges.shift(),
  };
}

function preparedFrom(body: RegisterCorrectionPreparation) {
  return {
    uuid: body.operationId,
    company: 'paper',
    register: 'register-ordinary',
    corrects: body.correctsId,
    baseSequence: 2,
    baseHash: 'c'.repeat(64),
    effectiveOn: body.effectiveOn,
    changes: [
      { member: 'member-1', shares: BIG },
      { member: 'member-2', shares: `-${BIG}` },
    ],
    authority: body.authority,
    approvingDirector: body.approvingDirector ?? '',
    authorityReference: body.authorityReference,
    reason: body.reason,
    sourceDocument: null,
    evidenceFingerprint: 'b'.repeat(64),
    evidenceSnapshot: {},
    authorityEvidence: body.authorityEvidence,
    preparingAppointment: body.appointment,
    preparedByName: 'Pat Preparer',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    appliedEntry: null,
    decisions: [],
    createdAt: '2026-10-05T00:00:00Z',
  };
}

const uploads = () => post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE);
const preparations = () =>
  post.mock.calls
    .filter(([url]) => url === URLS.REGISTER_CORRECTIONS)
    .map(([, body]) => body as RegisterCorrectionPreparation);
const reads = (url: string) => get.mock.calls.filter(([called]) => called === url).length;
const entryReads = () =>
  get.mock.calls
    .filter(([called]) => called === URLS.REGISTER_ENTRIES('ordinary'))
    .map(([, config]) => config as { params: { entry: string[]; page: number }; ledovaSessionEpoch: number });
const submit = (view: Awaited<ReturnType<typeof render>>) =>
  fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function open() {
  const view = await render(<PrepareRegisterCorrectionScreen />, { wrapper });
  await view.findByTestId('prepare-correction-screen');
  return view;
}

async function complete(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(view.getByRole('button', { name: 'Choose the authority document' }));
  await view.findByRole('button', { name: 'Replace the authority document' });
  const entries: [string, string][] = [
    [COPY.APPROVING_DIRECTOR, ' Dana Director '],
    [COPY.AUTHORITY_REFERENCE, 'RESOLUTION-7'],
    [COPY.REASON, ' Reverse the mistaken transfer '],
    [COPY.EFFECTIVE_ON, '2026-09-20'],
  ];
  for (const [label, value] of entries) await fireEvent.changeText(view.getByLabelText(label), value);
}

beforeEach(() => {
  resetFiles();
  append = jest.spyOn(FormData.prototype, 'append');
  mockParams = { tokenUuid: 'ordinary', companyUuid: 'paper', entryUuid: 'entry-2' };
  lookupEntries = [TRANSFER, OPENING];
  appointments = [appointment('appointment-prepare', ['prepare'])];
  readsFail = false;
  held = new Set();
  lookupAnswer = null;
  evidenceChanges = [];
  let keys = 0;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => KEY(++keys) as ReturnType<typeof Crypto.randomUUID>);
  let picks = 0;
  pick.mockReset().mockImplementation(async () => pickedFile(++picks));
  mockGoBack.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  get.mockReset().mockImplementation(async (url, config) => {
    const wanted = (config?.params as { entry?: string[] } | undefined)?.entry ?? [];
    if (readsFail) throw new Error('Unavailable');
    if (held.has(url)) return new Promise(() => {}) as ReturnType<typeof get>;
    if (url === URLS.HOLDERS('ordinary')) return { data: register };
    if (url === APPOINTMENTS) return { data: { results: appointments, next: null, count: appointments.length } };
    if (url === URLS.REGISTER_ENTRIES('ordinary')) {
      const results = lookupEntries.filter(({ uuid }) => wanted.includes(uuid));
      return lookupAnswer?.() ?? { data: { results, next: null, count: results.length } };
    }
    throw new Error(`Unexpected ${url}`);
  });
  prepareAnswer = jest.fn(async (body: RegisterCorrectionPreparation) => ({ data: preparedFrom(body) }));
  post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_EVIDENCE) return { data: evidenceFor(body) };
    if (url === URLS.REGISTER_CORRECTIONS) return prepareAnswer(body);
    throw new Error(`Unexpected ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('shows the entry and its exact inverse, uploads the authority document and prepares exactly that correction', async () => {
  const view = await open();
  const epoch = getSessionEpoch();
  const session = { ledovaSessionEpoch: epoch, signal: expect.objectContaining({ aborted: false }) };
  expect(get).toHaveBeenCalledWith(URLS.HOLDERS('ordinary'), session);
  expect(get).toHaveBeenCalledWith(APPOINTMENTS, { ...session, params: { page: 1 } });
  expect(entryReads()).toEqual([
    { ...session, paramsSerializer: { indexes: null }, params: { entry: ['entry-2'], page: 1 } },
  ]);
  client.setQueryData(correctionsKey(epoch, 'ordinary'), []);
  expect(view.getByText('Entry 2 · Transfer')).toBeTruthy();
  expect(view.getByText('Effective 10 September 2026')).toBeTruthy();
  expect(view.getByText('Alex Member: -9,007,199,254,740,993')).toBeTruthy();
  expect(view.getByText('Blair Member: +9,007,199,254,740,993')).toBeTruthy();
  expect(view.getByText('Alex Member: +9,007,199,254,740,993')).toBeTruthy();
  expect(view.getByText('Blair Member: -9,007,199,254,740,993')).toBeTruthy();
  expect(view.getByText(COPY.AUTHORITY_DOCUMENT_NOTE)).toBeTruthy();
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  await complete(view);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  const [upload] = uploads();
  expect(parts(upload[1])).toEqual([
    ['company_id', 'paper'],
    ['appointment', 'appointment-prepare'],
    ['kind', 'authority'],
    ['idempotency_key', KEY(1)],
    ['file', expect.objectContaining({ name: '1.pdf', type: 'application/pdf' })],
  ]);
  expect(upload[2]).toEqual({
    ledovaSessionEpoch: epoch,
    ledovaSubmissionGuard: expect.any(Function),
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_CORRECTIONS,
    {
      operationId: KEY(2),
      appointment: 'appointment-prepare',
      correctsId: 'entry-2',
      authorityEvidence: 'evidence-authority',
      effectiveOn: '2026-09-20',
      authority: 'director_resolution',
      approvingDirector: 'Dana Director',
      authorityReference: 'RESOLUTION-7',
      reason: 'Reverse the mistaken transfer',
    },
    { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: expect.any(Function) },
  );
  expect(client.getQueryState(correctionsKey(epoch, 'ordinary'))?.isInvalidated).toBe(true);
  expect([...files.keys()].some((uri) => uri.includes('ledova-upload-copies'))).toBe(false);
});

it('prepares under a court order without an approving director', async () => {
  const view = await open();
  await complete(view);
  await fireEvent.press(view.getByRole('radio', { name: COPY.AUTHORITIES.court_order }));
  expect(view.queryByLabelText(COPY.APPROVING_DIRECTOR)).toBeNull();
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations()).toEqual([expect.objectContaining({ authority: 'court_order', approvingDirector: '' })]);
});

it('reads the entry it corrects by that entry alone, and names an unnamed member neutrally', async () => {
  mockParams = { ...mockParams, entryUuid: 'entry-1' };
  const view = await open();
  expect(entryReads().map(({ params }) => params)).toEqual([{ entry: ['entry-1'], page: 1 }]);
  expect(view.getByText('Entry 1 · Opening state')).toBeTruthy();
  expect(view.getByText(`${COPY.UNNAMED_MEMBER('member-1')}: +40`)).toBeTruthy();
  expect(view.getByText(`${COPY.UNNAMED_MEMBER('member-1')}: -40`)).toBeTruthy();
});

it('dates the correction today in UTC by default and holds a date after it', async () => {
  jest.useFakeTimers({
    now: new Date('2026-10-05T23:30:00Z'),
    advanceTimers: true,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  const view = await open();
  expect(view.getByLabelText(COPY.EFFECTIVE_ON).props.value).toBe('2026-10-05');
  await complete(view);
  await fireEvent.changeText(view.getByLabelText(COPY.EFFECTIVE_ON), '2026-10-06');
  expect(view.getByText(LATE_DATE)).toBeTruthy();
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  await fireEvent.changeText(view.getByLabelText(COPY.EFFECTIVE_ON), '2026-10-05');
  expect(view.queryByText(LATE_DATE)).toBeNull();
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations()).toEqual([expect.objectContaining({ effectiveOn: '2026-10-05' })]);
});

it.each([
  ['no authority document', null, '', 'Choose the authority document.'],
  ['an impossible effective date', COPY.EFFECTIVE_ON, '2026-02-30', LATE_DATE],
  ['an effective date in another format', COPY.EFFECTIVE_ON, '20/09/2026', LATE_DATE],
  ['no approving director', COPY.APPROVING_DIRECTOR, ' ', 'Name the director who approved the resolution.'],
  [
    'no authority reference',
    COPY.AUTHORITY_REFERENCE,
    ' ',
    'Enter the authority reference and the reason for the correction.',
  ],
  ['no reason', COPY.REASON, ' ', 'Enter the authority reference and the reason for the correction.'],
])('holds preparation for %s', async (_, label, value, problem) => {
  const view = await open();
  await complete(view);
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeEnabled();
  if (label) await fireEvent.changeText(view.getByLabelText(label), value);
  else await fireEvent.press(view.getByRole('button', { name: 'Remove the authority document' }));
  expect(view.getByText(problem)).toBeTruthy();
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  await submit(view);
  expect(post).not.toHaveBeenCalled();
});

it('limits each authority field to the length the API accepts', async () => {
  const view = await open();
  expect(view.getByLabelText(COPY.APPROVING_DIRECTOR).props.maxLength).toBe(255);
  expect(view.getByLabelText(COPY.AUTHORITY_REFERENCE).props.maxLength).toBe(255);
  expect(view.getByLabelText(COPY.REASON).props.maxLength).toBe(1000);
});

it('retries an interrupted preparation under its operation id with the confirmed upload, and a change takes a new id', async () => {
  prepareAnswer.mockRejectedValueOnce(new Error('Network Error')).mockRejectedValueOnce(new Error('Network Error'));
  const view = await open();
  await complete(view);
  await submit(view);
  expect(await view.findByText(FAILED)).toBeTruthy();
  expect(view.getByText('1.pdf · uploaded')).toBeTruthy();
  await submit(view);
  await waitFor(() => expect(preparations()).toHaveLength(2));
  await view.findByText(FAILED);
  await fireEvent.changeText(view.getByLabelText(COPY.REASON), 'Reverse the transfer recorded in error');
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(2), KEY(2), KEY(3)]);
  expect(preparations()[1]).toEqual(preparations()[0]);
  expect(uploads()).toHaveLength(1);
});

it('reads the entry and appointments again after a conflict and prepares under a new operation id', async () => {
  prepareAnswer.mockRejectedValueOnce({
    response: { status: 409, data: { detail: 'The register operation conflicts with its recorded identity.' } },
  });
  const view = await open();
  await complete(view);
  const before = [reads(URLS.REGISTER_ENTRIES('ordinary')), reads(APPOINTMENTS)];
  await submit(view);
  expect(await view.findByText('The register operation conflicts with its recorded identity.')).toBeTruthy();
  await waitFor(() => expect(reads(URLS.REGISTER_ENTRIES('ordinary'))).toBeGreaterThan(before[0]));
  expect(reads(APPOINTMENTS)).toBeGreaterThan(before[1]);
  await waitFor(() => expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeEnabled());
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(2), KEY(3)]);
});

it('shows why a preparation was refused and prepares the next attempt under a new operation id', async () => {
  prepareAnswer.mockRejectedValueOnce({
    response: { status: 400, data: ['Applying this correction would take a member’s holding below zero.'] },
  });
  const view = await open();
  await complete(view);
  const before = reads(URLS.REGISTER_ENTRIES('ordinary'));
  await submit(view);
  expect(await view.findByText('Applying this correction would take a member’s holding below zero.')).toBeTruthy();
  expect(reads(URLS.REGISTER_ENTRIES('ordinary'))).toBe(before);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(2), KEY(3)]);
});

it.each([
  ['another entry', { corrects: 'entry-1' }],
  ['another authority document', { authorityEvidence: 'evidence-other' }],
  ['another reason', { reason: 'Something else' }],
  ['a staff-era provenance', { providedBy: 'staff_verified' }],
])('stays open and leaves the corrections unchanged when the prepared correction names %s', async (_, changes) => {
  prepareAnswer.mockImplementationOnce(async (body: RegisterCorrectionPreparation) => ({
    data: { ...preparedFrom(body), ...changes },
  }));
  const view = await open();
  const key = correctionsKey(getSessionEpoch(), 'ordinary');
  client.setQueryData(key, []);
  await complete(view);
  await submit(view);
  expect(await view.findByText(COPY.PREPARATION_RECEIPT_FAILED)).toBeTruthy();
  expect(mockGoBack).not.toHaveBeenCalled();
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(2), KEY(2)]);
});

it('prepares nothing when the upload receipt cannot be confirmed, then uploads the file again under a new key', async () => {
  evidenceChanges = [{ kind: 'share_register' }];
  const view = await open();
  await complete(view);
  await submit(view);
  expect(await view.findByText(COPY.UPLOAD_RECEIPT_FAILED)).toBeTruthy();
  expect(preparations()).toEqual([]);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(uploads().map(([, form]) => field(form, 'idempotency_key'))).toEqual([KEY(1), KEY(2)]);
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(3)]);
});

it('writes nothing and stays put when the session changes while preparing', async () => {
  let answer!: (value: unknown) => void;
  prepareAnswer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const view = await open();
  const epoch = getSessionEpoch();
  const key = correctionsKey(epoch, 'ordinary');
  client.setQueryData(key, []);
  await complete(view);
  await submit(view);
  await waitFor(() => expect(answer).toBeDefined());
  await act(() => invalidateSessionScope());
  await act(async () => answer({ data: preparedFrom(preparations()[0]) }));
  expect(mockGoBack).not.toHaveBeenCalled();
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  expect(view.queryByText(FAILED)).toBeNull();
  await view.findByTestId('prepare-correction-screen');
  expect(get).toHaveBeenCalledWith(
    URLS.REGISTER_ENTRIES('ordinary'),
    expect.objectContaining({ ledovaSessionEpoch: epoch + 1 }),
  );
});

it('starts a fresh draft for a new session', async () => {
  const view = await open();
  await complete(view);
  await act(() => invalidateSessionScope());
  await view.findByTestId('prepare-correction-screen');
  expect(view.getByLabelText(COPY.REASON).props.value).toBe('');
  expect(view.getByLabelText(COPY.AUTHORITY_REFERENCE).props.value).toBe('');
  expect(view.getByRole('button', { name: 'Choose the authority document' })).toBeTruthy();
});

it.each([
  ['class', URLS.HOLDERS('ordinary')],
  ['entries', URLS.REGISTER_ENTRIES('ordinary')],
  ['appointments', APPOINTMENTS],
])('shows a new session no form until its own %s read answers', async (_, url) => {
  const view = await open();
  held = new Set([url]);
  await act(() => invalidateSessionScope());
  await waitFor(() => expect(client.isFetching()).toBe(1));
  await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(view.getByText('Loading the register entry…')).toBeTruthy();
  expect(view.queryByTestId('prepare-correction-screen')).toBeNull();
});

it.each([
  ['a register reader', ['read_register']],
  ['an approver', ['approve']],
])('shows %s the read-only note instead of the preparation form', async (_, capabilities) => {
  appointments = [appointment('appointment-other', capabilities)];
  const view = await render(<PrepareRegisterCorrectionScreen />, { wrapper });
  expect(await view.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Choose the authority document' })).toBeNull();
  expect(view.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
});

it.each([
  [
    'has been corrected',
    () => (lookupEntries = [{ ...TRANSFER, correctable: false, correctedBy: 'entry-1' }, OPENING]),
    'A correction has reversed this entry, or it records no change, so it cannot be corrected.',
  ],
  [
    'is not in the class register',
    () => (mockParams = { ...mockParams, entryUuid: 'entry-elsewhere' }),
    'This entry is not in the register of this share class.',
  ],
])('explains an entry that %s and offers no form', async (_, arrange, explanation) => {
  arrange();
  const view = await render(<PrepareRegisterCorrectionScreen />, { wrapper });
  expect(await view.findByText(explanation)).toBeTruthy();
  expect(view.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
});

it('refuses an entry lookup that answers with another entry, and retries it', async () => {
  lookupAnswer = async () => ({ data: { results: [OPENING], next: null, count: 1 } });
  const view = await render(<PrepareRegisterCorrectionScreen />, { wrapper });
  expect(await view.findByText('We couldn’t load this register entry and your appointments.')).toBeTruthy();
  expect(view.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
  lookupAnswer = null;
  await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
  expect(await view.findByTestId('prepare-correction-screen')).toBeTruthy();
});

it('drops an entry lookup answered after the session changes and reads the entry again for the new session', async () => {
  let answer!: (value: unknown) => void;
  lookupAnswer = () =>
    new Promise((resolve) => {
      answer = resolve;
    });
  const view = await render(<PrepareRegisterCorrectionScreen />, { wrapper });
  await waitFor(() => expect(answer).toBeDefined());
  const epoch = getSessionEpoch();
  const [retired] = get.mock.calls.filter(([url]) => url === URLS.REGISTER_ENTRIES('ordinary'));
  lookupAnswer = null;
  await act(() => invalidateSessionScope());
  expect((retired[1] as { signal: AbortSignal }).signal.aborted).toBe(true);
  await act(async () => answer({ data: { results: [OPENING], next: null, count: 1 } }));
  await view.findByTestId('prepare-correction-screen');
  expect(view.getByText('Entry 2 · Transfer')).toBeTruthy();
  expect(entryReads().map(({ ledovaSessionEpoch, params }) => [ledovaSessionEpoch, params])).toEqual([
    [epoch, { entry: ['entry-2'], page: 1 }],
    [epoch + 1, { entry: ['entry-2'], page: 1 }],
  ]);
});

it('offers a retry instead of the form when the entry cannot be read', async () => {
  readsFail = true;
  const view = await render(<PrepareRegisterCorrectionScreen />, { wrapper });
  expect(await view.findByText('We couldn’t load this register entry and your appointments.')).toBeTruthy();
  expect(view.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
  readsFail = false;
  await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
  expect(await view.findByTestId('prepare-correction-screen')).toBeTruthy();
});

import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_PARTICULARS_COPY as COPY,
  type RegisterParticularsChangePreparation,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import * as sessionScope from '../../services/sessionScope';
import { pickedFile, resetFiles } from '../../testSupport/documentFiles';
import { PrepareRegisterParticularsScreen } from './PrepareRegisterParticularsScreen';
import { particularsKey } from './useCompanyRegister';

const MEMBER_A = '10000000-0000-4000-8000-0000000000aa';
const mockGoBack = jest.fn();
const mockParams = { tokenUuid: 'ordinary', companyUuid: 'paper', memberUuid: MEMBER_A };
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
const HOLDERS = URLS.HOLDERS('ordinary');
const ADDRESS = '8 Synthetic Street, Melbourne VIC 3000';
const CONFLICT = 'The register operation conflicts with its recorded identity or holdings.';
const KEY = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const pick = jest.mocked(DocumentPicker.getDocumentAsync);
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
let client: QueryClient;
let appointments: unknown[];
let evidenceChanges: object[];
let prepareAnswer: jest.Mock;
let append: jest.SpyInstance<ReturnType<FormData['append']>, Parameters<FormData['append']>>;

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
    uuid: 'evidence-supporting',
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

function preparedFrom(body: RegisterParticularsChangePreparation) {
  return {
    uuid: body.operationId,
    company: 'paper',
    member: body.member,
    name: body.name,
    residentialAddress: body.residentialAddress,
    asAt: body.asAt,
    reason: body.reason,
    evidenceFingerprint: 'b'.repeat(64),
    evidenceSnapshot: {},
    supportingEvidence: body.supportingEvidence,
    preparingAppointment: body.appointment,
    preparedByName: 'Pat Preparer',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    createdAt: '2026-10-05T00:00:00Z',
  };
}

const uploads = () => post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE);
const preparations = () =>
  post.mock.calls
    .filter(([url]) => url === URLS.REGISTER_PARTICULARS_CHANGES)
    .map(([, body]) => body as RegisterParticularsChangePreparation);
const reads = (url: string) => get.mock.calls.filter(([called]) => called === url).length;
const submit = (view: Awaited<ReturnType<typeof render>>) =>
  fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
const settled = (view: Awaited<ReturnType<typeof render>>) =>
  waitFor(() => expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeEnabled());
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function open() {
  const view = await render(<PrepareRegisterParticularsScreen />, { wrapper });
  await view.findByTestId('prepare-particulars-screen');
  return view;
}

async function complete(view: Awaited<ReturnType<typeof render>>) {
  const entries: [string, string][] = [
    [COPY.NAME, ' Alexandra Member '],
    [COPY.RESIDENTIAL_ADDRESS, ` ${ADDRESS} `],
    [COPY.AS_AT, '2026-09-20'],
    [COPY.REASON, ' Changed name by deed poll and moved '],
  ];
  for (const [label, value] of entries) await fireEvent.changeText(view.getByLabelText(label), value);
  await fireEvent.press(view.getByRole('button', { name: 'Choose the supporting document' }));
  await view.findByRole('button', { name: 'Replace the supporting document' });
}

beforeEach(() => {
  resetFiles();
  append = jest.spyOn(FormData.prototype, 'append');
  appointments = [appointment('appointment-prepare', ['prepare'])];
  evidenceChanges = [];
  let keys = 0;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => KEY(++keys) as ReturnType<typeof Crypto.randomUUID>);
  let picks = 0;
  pick.mockReset().mockImplementation(async () => pickedFile(++picks));
  mockGoBack.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  get.mockReset().mockImplementation(async (url) => {
    if (url === HOLDERS) return { data: register };
    if (url === APPOINTMENTS) return { data: { results: appointments, next: null, count: appointments.length } };
    throw new Error(`Unexpected ${url}`);
  });
  prepareAnswer = jest.fn(async (body: RegisterParticularsChangePreparation) => ({ data: preparedFrom(body) }));
  post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_EVIDENCE) return { data: evidenceFor(body) };
    if (url === URLS.REGISTER_PARTICULARS_CHANGES) return prepareAnswer(body);
    throw new Error(`Unexpected ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

it('names the member as the register does, uploads the supporting document and prepares exactly that change', async () => {
  const view = await open();
  const epoch = sessionScope.getSessionEpoch();
  const session = { ledovaSessionEpoch: epoch, signal: expect.objectContaining({ aborted: false }) };
  expect(get).toHaveBeenCalledWith(HOLDERS, session);
  expect(get).toHaveBeenCalledWith(APPOINTMENTS, { ...session, params: { page: 1 } });
  client.setQueryData(particularsKey(epoch, 'paper'), []);
  expect(view.getByText(`${COPY.PREPARE} for Alex Member.`)).toBeTruthy();
  expect(view.getByText(COPY.PRECEDENCE_NOTE)).toBeTruthy();
  expect(view.getByText(COPY.SUPPORTING_DOCUMENT_NOTE)).toBeTruthy();
  expect(view.getByLabelText(COPY.AS_AT).props.value).toBe(new Date().toISOString().slice(0, 10));
  expect(view.getByLabelText(COPY.NAME).props.maxLength).toBe(255);
  expect(view.getByLabelText(COPY.RESIDENTIAL_ADDRESS).props.maxLength).toBe(1000);
  expect(view.getByLabelText(COPY.REASON).props.maxLength).toBe(1000);
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  await complete(view);
  await fireEvent.changeText(
    view.getByLabelText(COPY.AS_AT),
    new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
  );
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  await fireEvent.changeText(view.getByLabelText(COPY.AS_AT), '2026-09-20');
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  const [upload] = uploads();
  expect(parts(upload[1])).toEqual([
    ['company_id', 'paper'],
    ['appointment', 'appointment-prepare'],
    ['kind', 'supporting'],
    ['idempotency_key', KEY(1)],
    ['file', expect.objectContaining({ name: '1.pdf', type: 'application/pdf' })],
  ]);
  expect(upload[2]).toEqual({
    ledovaSessionEpoch: epoch,
    ledovaSubmissionGuard: expect.any(Function),
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_PARTICULARS_CHANGES,
    {
      operationId: KEY(2),
      appointment: 'appointment-prepare',
      member: MEMBER_A,
      supportingEvidence: 'evidence-supporting',
      name: 'Alexandra Member',
      residentialAddress: ADDRESS,
      asAt: '2026-09-20',
      reason: 'Changed name by deed poll and moved',
    },
    { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: expect.any(Function) },
  );
  expect(client.getQueryState(particularsKey(epoch, 'paper'))?.isInvalidated).toBe(true);
});

it.each([
  ['an administrator', ['admin'], 'paper', true],
  ['an approver', ['approve'], 'paper', false],
  ['an appointee who applies', ['apply'], 'paper', false],
  ['a register reader', ['read_register'], 'paper', false],
  ['another company’s preparer', ['prepare'], 'garden', false],
])('decides by its own appointments whether %s may prepare', async (_, capabilities, company, prepares) => {
  appointments = [appointment('appointment-step', capabilities, { company })];
  const view = await render(<PrepareRegisterParticularsScreen />, { wrapper });
  expect(await view.findByText(`${COPY.PREPARE} for Alex Member.`)).toBeTruthy();
  expect(!!view.queryByTestId('prepare-particulars-screen')).toBe(prepares);
  expect(!!view.queryByText(COPY.READ_ONLY_NOTE)).toBe(!prepares);
});

it('retries an interrupted preparation under its operation id with the confirmed upload, and a changed detail takes a new id', async () => {
  prepareAnswer.mockRejectedValueOnce(new Error('Network Error')).mockRejectedValueOnce(new Error('Network Error'));
  const view = await open();
  await complete(view);
  await submit(view);
  await waitFor(() => expect(preparations()).toHaveLength(1));
  await settled(view);
  await submit(view);
  await waitFor(() => expect(preparations()).toHaveLength(2));
  await settled(view);
  await fireEvent.changeText(view.getByLabelText(COPY.REASON), 'Changed name by deed poll');
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(2), KEY(2), KEY(3)]);
  expect(preparations()[1]).toEqual(preparations()[0]);
  expect(uploads()).toHaveLength(1);
});

it('reads the member and appointments again after a conflict and prepares under a new operation id', async () => {
  prepareAnswer.mockRejectedValueOnce({ response: { status: 409, data: { detail: CONFLICT } } });
  const view = await open();
  await complete(view);
  const before = [reads(HOLDERS), reads(APPOINTMENTS)];
  await submit(view);
  expect(await view.findByText(CONFLICT)).toBeTruthy();
  await waitFor(() => expect(reads(HOLDERS)).toBeGreaterThan(before[0]));
  expect(reads(APPOINTMENTS)).toBeGreaterThan(before[1]);
  await settled(view);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(2), KEY(3)]);
});

it('shows a refusal in the server’s words and prepares the next attempt under a new operation id', async () => {
  const refusal = 'The register already records this member’s particulars as at 2026-09-30, after 2026-09-20.';
  prepareAnswer.mockRejectedValueOnce({ response: { status: 400, data: [refusal] } });
  const view = await open();
  await complete(view);
  const before = [reads(HOLDERS), reads(APPOINTMENTS)];
  await submit(view);
  expect(await view.findByText(refusal)).toBeTruthy();
  expect([reads(HOLDERS), reads(APPOINTMENTS)]).toEqual(before);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(2), KEY(3)]);
});

it('reads the appointments again after a refused preparation and withdraws the form once the appointment is gone', async () => {
  prepareAnswer.mockRejectedValueOnce({ response: { status: 404, data: { detail: 'Not found.' } } });
  const view = await open();
  await complete(view);
  const before = reads(APPOINTMENTS);
  appointments = [];
  await submit(view);
  expect(await view.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(reads(APPOINTMENTS)).toBe(before + 1);
  expect(view.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
});

it.each([
  ['another member', { member: '10000000-0000-4000-8000-0000000000bb' }],
  ['another supporting document', { supportingEvidence: 'evidence-other' }],
  ['another as-at date', { asAt: '2026-09-21' }],
])('stays open and leaves the changes unread when the prepared change names %s', async (_, changes) => {
  prepareAnswer.mockImplementationOnce(async (body: RegisterParticularsChangePreparation) => ({
    data: { ...preparedFrom(body), ...changes },
  }));
  const view = await open();
  const key = particularsKey(sessionScope.getSessionEpoch(), 'paper');
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
  evidenceChanges = [{ kind: 'authority' }];
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

it('writes nothing and stays put when the session changes while preparing, and starts the new session afresh', async () => {
  let answer!: (value: unknown) => void;
  prepareAnswer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const view = await open();
  const epoch = sessionScope.getSessionEpoch();
  const key = particularsKey(epoch, 'paper');
  client.setQueryData(key, []);
  await complete(view);
  await submit(view);
  await waitFor(() => expect(answer).toBeDefined());
  await act(() => sessionScope.invalidateSessionScope());
  await act(async () => answer({ data: preparedFrom(preparations()[0]) }));
  expect(mockGoBack).not.toHaveBeenCalled();
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  await view.findByTestId('prepare-particulars-screen');
  expect(get).toHaveBeenCalledWith(HOLDERS, expect.objectContaining({ ledovaSessionEpoch: epoch + 1 }));
  expect(view.getByLabelText(COPY.NAME).props.value).toBe('');
  expect(view.getByRole('button', { name: 'Choose the supporting document' })).toBeTruthy();
});

it('writes nothing for a preparation answered after the session changes, even before the page gives way', async () => {
  jest.spyOn(sessionScope, 'subscribeSession').mockReturnValue(() => {});
  let answer!: (value: unknown) => void;
  prepareAnswer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const view = await open();
  const key = particularsKey(sessionScope.getSessionEpoch(), 'paper');
  client.setQueryData(key, []);
  await complete(view);
  await submit(view);
  await waitFor(() => expect(answer).toBeDefined());
  sessionScope.invalidateSessionScope();
  await act(async () => answer({ data: preparedFrom(preparations()[0]) }));
  expect(mockGoBack).not.toHaveBeenCalled();
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
});

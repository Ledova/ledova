import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  formatDateToString,
  REGISTER_IMPORT_COPY as COPY,
  type RegisterImportPreparation,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { files, pickedFile, resetFiles } from '../../testSupport/documentFiles';
import { PrepareRegisterImportScreen } from './PrepareRegisterImportScreen';
import { importsKey } from './useCompanyRegister';

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useRoute: () => ({ params: { tokenUuid: 'ordinary', companyUuid: 'paper' } }),
}));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../services/tokenStorage', () => ({ getAccessToken: jest.fn(async () => 'synthetic-access') }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);

type Upload = [string, unknown];
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const FAILED = 'The import could not be prepared. Retry with the same details.';
const MISMATCH = 'The ASIC extract figures differ from the import rows. Correct them before preparing the import.';
const NO_HOLDERS = 'The stored register lists no current members, so this class has none to import.';
const ADD_MEMBERS = 'Add each current member in the company’s register, with their shares. Each gets a new member ID.';
const KEY = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const pick = jest.mocked(DocumentPicker.getDocumentAsync);
const opened = {
  token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'deployed', totalSupply: '1000' },
  issuedSupply: '100' as string | null,
  initialized: true,
  waitingEffects: 0,
  totalHolders: 2,
  holders: [
    {
      member: 'member-1',
      name: 'Alex Member' as string | null,
      holderType: 'member',
      balance: '60',
      enteredOn: '2026-09-01',
      wallets: [],
    },
    { member: 'member-2', name: null, holderType: 'unidentified', balance: '40', enteredOn: '2026-09-01', wallets: [] },
  ],
};
const unopened = { ...opened, initialized: false, issuedSupply: null, totalHolders: 0, holders: [] };
const MEMBERS = [
  {
    member: 'member-1',
    name: 'Alex Member',
    residentialAddress: '1 Synthetic Street',
    shares: '60',
    enteredOn: '2019-05-01',
    amountPaid: '250.00',
  },
  {
    member: 'member-2',
    name: 'Blair Member',
    residentialAddress: '2 Synthetic Road',
    shares: '40',
    enteredOn: '2020-01-01',
    amountPaid: null,
  },
];
let client: QueryClient;
let holders: typeof opened;
let appointments: unknown[];
let readsFail: boolean;
let held: Set<string>;
let evidenceChanges: object[];
let uploadFailures: unknown[];
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
  const kind = field(form, 'kind');
  return {
    uuid: kind === 'share_register' ? 'evidence-register' : 'evidence-asic',
    company: field(form, 'company_id'),
    appointment: field(form, 'appointment'),
    kind,
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

function preparedFrom(body: RegisterImportPreparation) {
  return {
    uuid: body.operationId,
    company: 'paper',
    token: body.tokenId,
    preparingAppointment: body.appointment,
    registerEvidence: body.registerEvidence,
    asicEvidence: body.asicEvidence,
    asicIssuedTotal: body.asicIssuedTotal,
    asicMemberCount: body.asicMemberCount,
    asAt: body.asAt,
    providedBy: 'company',
    status: 'submitted',
    stage: 'submitted',
    members: body.members.map(({ name, member, shares, enteredOn, amountPaid, residentialAddress }) => ({
      name,
      member,
      shares,
      enteredOn,
      amountPaid,
      residentialAddress,
    })),
    formerMembers: body.formerMembers,
    decisions: [],
    rejectionReason: '',
    reviewedAt: null,
    createdAt: '2026-10-05T00:00:00Z',
  };
}

const uploads = () => post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE);
const preparations = () =>
  post.mock.calls.filter(([url]) => url === URLS.REGISTER_IMPORTS).map(([, body]) => body as RegisterImportPreparation);
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function open() {
  const view = await render(<PrepareRegisterImportScreen />, { wrapper });
  await view.findByTestId('prepare-import-screen');
  return view;
}

async function chooseEvidence(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(view.getByRole('button', { name: 'Choose the share register' }));
  await view.findByRole('button', { name: 'Replace the share register' });
  await fireEvent.press(view.getByRole('button', { name: 'Choose the ASIC extract' }));
  await view.findByRole('button', { name: 'Replace the ASIC extract' });
}

async function complete(view: Awaited<ReturnType<typeof render>>, total = '100') {
  await chooseEvidence(view);
  const entries: [string, string][] = [
    ['Register date', '2026-09-20'],
    ['Member 1 residential address', ' 1 Synthetic Street '],
    ['Member 1 date entered', '2019-05-01'],
    ['Member 1 amount paid', '250.00'],
    ['Member 2 name', 'Blair Member'],
    ['Member 2 residential address', '2 Synthetic Road'],
    ['Member 2 date entered', '2020-01-01'],
    ['ASIC issued total', total],
    ['ASIC member count', '2'],
    ['Approving director', 'Dana Director'],
    ['Authority reference', 'RESOLUTION-1'],
    ['Reason', 'Import the company register'],
  ];
  for (const [label, value] of entries) await fireEvent.changeText(view.getByLabelText(label), value);
}

beforeEach(() => {
  resetFiles();
  append = jest.spyOn(FormData.prototype, 'append');
  holders = opened;
  appointments = [appointment('appointment-prepare', ['prepare'])];
  readsFail = false;
  held = new Set();
  evidenceChanges = [];
  uploadFailures = [];
  let keys = 0;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => KEY(++keys) as ReturnType<typeof Crypto.randomUUID>);
  let picks = 0;
  pick.mockReset().mockImplementation(async () => pickedFile(++picks));
  mockGoBack.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  get.mockReset().mockImplementation(async (url) => {
    if (readsFail) throw new Error('Unavailable');
    if (held.has(url)) return new Promise(() => {}) as ReturnType<typeof get>;
    if (url === URLS.HOLDERS('ordinary')) return { data: holders };
    if (url === APPOINTMENTS) return { data: { results: appointments, next: null, count: appointments.length } };
    throw new Error(`Unexpected ${url}`);
  });
  prepareAnswer = jest.fn(async (body: RegisterImportPreparation) => ({ data: preparedFrom(body) }));
  post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_EVIDENCE) {
      const failure = uploadFailures.shift();
      if (failure) throw failure;
      return { data: evidenceFor(body) };
    }
    if (url === URLS.REGISTER_IMPORTS) return prepareAnswer(body);
    throw new Error(`Unexpected ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

it('prepares an opened class from its stored holdings with exact uploads and body, then refreshes its imports', async () => {
  const view = await open();
  const epoch = getSessionEpoch();
  const session = { ledovaSessionEpoch: epoch, signal: expect.objectContaining({ aborted: false }) };
  expect(get).toHaveBeenCalledWith(URLS.HOLDERS('ordinary'), session);
  expect(get).toHaveBeenCalledWith(APPOINTMENTS, { ...session, params: { page: 1 } });
  client.setQueryData(importsKey(epoch, 'ordinary'), []);
  expect(view.getByLabelText('Register date').props.value).toBe(formatDateToString(new Date()));
  expect(view.getByText('Member ID member-1')).toBeTruthy();
  expect(view.getByText('60 shares')).toBeTruthy();
  expect(view.getByText('40 shares')).toBeTruthy();
  expect(view.queryByLabelText('Member 1 shares')).toBeNull();
  expect(view.queryByRole('button', { name: 'Add a member' })).toBeNull();
  expect(view.queryByText(COPY.NOT_ON_CHAIN_NOTE)).toBeNull();
  expect(view.getByLabelText('Member 1 name').props.value).toBe('Alex Member');
  expect(view.getByLabelText('Member 2 name').props.value).toBe('');
  expect(view.getByRole('button', { name: COPY.PREPARE })).toBeDisabled();
  await complete(view);
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  const [shareRegister, asicExtract] = uploads();
  for (const [upload, kind, key, name] of [
    [shareRegister, 'share_register', KEY(1), '1.pdf'],
    [asicExtract, 'asic_extract', KEY(2), '2.pdf'],
  ] as const) {
    expect(parts(upload[1])).toEqual([
      ['company_id', 'paper'],
      ['appointment', 'appointment-prepare'],
      ['kind', kind],
      ['idempotency_key', key],
      ['file', expect.objectContaining({ name, type: 'application/pdf' })],
    ]);
    expect(upload[2]).toEqual({
      ledovaSessionEpoch: epoch,
      ledovaSubmissionGuard: expect.any(Function),
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  }
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_IMPORTS,
    {
      operationId: KEY(3),
      appointment: 'appointment-prepare',
      tokenId: 'ordinary',
      registerEvidence: 'evidence-register',
      asicEvidence: 'evidence-asic',
      asicIssuedTotal: '100',
      asicMemberCount: 2,
      asAt: '2026-09-20',
      members: MEMBERS,
      formerMembers: [],
      authority: 'director_resolution',
      approvingDirector: 'Dana Director',
      authorityReference: 'RESOLUTION-1',
      reason: 'Import the company register',
    },
    { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: expect.any(Function) },
  );
  expect(client.getQueryState(importsKey(epoch, 'ordinary'))?.isInvalidated).toBe(true);
  expect([...files.keys()].some((uri) => uri.includes('ledova-upload-copies'))).toBe(false);
});

it('opens an unopened class with members it adds under new ids, editable shares and former members', async () => {
  holders = unopened;
  const view = await open();
  await fireEvent.press(view.getByRole('button', { name: 'Add a member' }));
  await fireEvent.press(view.getByRole('button', { name: 'Add a member' }));
  expect(view.getByText(`Member ID ${KEY(1)}`)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Remove member 1' }));
  expect(view.queryByText(`Member ID ${KEY(1)}`)).toBeNull();
  expect(view.getByText(`Member ID ${KEY(2)}`)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Add a former member' }));
  await chooseEvidence(view);
  const entries: [string, string][] = [
    ['Register date', '2026-09-20'],
    ['Member 1 shares', '007'],
    ['Member 1 name', ' Casey Member '],
    ['Member 1 residential address', '3 Synthetic Lane'],
    ['Member 1 date entered', '2018-02-01'],
    ['Former member 1 name', 'Fred Former'],
    ['Former member 1 residential address', '2 Synthetic Road, Hobart TAS 7000'],
    ['Former member 1 shares', '40'],
    ['Former member 1 date ceased', '2022-03-01'],
    ['ASIC issued total', '7'],
    ['ASIC member count', '1'],
    ['Authority reference', 'COURT-1'],
    ['Reason', 'Open the register from the company records'],
  ];
  for (const [label, value] of entries) await fireEvent.changeText(view.getByLabelText(label), value);
  await fireEvent.press(view.getByRole('radio', { name: 'Court order' }));
  expect(view.queryByLabelText('Approving director')).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations()).toEqual([
    expect.objectContaining({
      operationId: KEY(5),
      asicIssuedTotal: '7',
      asicMemberCount: 1,
      members: [
        {
          member: KEY(2),
          name: 'Casey Member',
          residentialAddress: '3 Synthetic Lane',
          shares: '7',
          enteredOn: '2018-02-01',
          amountPaid: null,
        },
      ],
      formerMembers: [
        {
          name: 'Fred Former',
          residentialAddress: '2 Synthetic Road, Hobart TAS 7000',
          shares: '40',
          ceasedOn: '2022-03-01',
        },
      ],
      authority: 'court_order',
      approvingDirector: '',
    }),
  ]);
  expect(uploads().map(([, form]) => field(form, 'idempotency_key'))).toEqual([KEY(3), KEY(4)]);
});

it('blocks preparation while the stated ASIC figures differ from the import rows', async () => {
  const view = await open();
  await complete(view, '99');
  expect(view.getByText(MISMATCH)).toBeTruthy();
  expect(view.getByText(COPY.STATED_FIGURES('99', 2))).toBeTruthy();
  expect(view.getByText(COPY.IMPORTED_FIGURES('100', 2))).toBeTruthy();
  expect(view.getByRole('button', { name: COPY.PREPARE })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  await fireEvent.changeText(view.getByLabelText('ASIC issued total'), '100');
  expect(view.queryByText(MISMATCH)).toBeNull();
  expect(view.getByRole('button', { name: COPY.PREPARE })).toBeEnabled();
  await fireEvent.changeText(view.getByLabelText('ASIC member count'), '3');
  expect(view.getByText(MISMATCH)).toBeTruthy();
  expect(view.getByRole('button', { name: COPY.PREPARE })).toBeDisabled();
  expect(post).not.toHaveBeenCalled();
});

it('retries an interrupted preparation under its operation id with the verified uploads, and a change takes a new id', async () => {
  prepareAnswer.mockRejectedValueOnce(new Error('Network Error')).mockRejectedValueOnce(new Error('Network Error'));
  const view = await open();
  await complete(view);
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  expect(await view.findByText(FAILED)).toBeTruthy();
  expect(view.getByText('1.pdf · uploaded')).toBeTruthy();
  expect(view.getByText('2.pdf · uploaded')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  await waitFor(() => expect(preparations()).toHaveLength(2));
  await view.findByText(FAILED);
  await fireEvent.changeText(view.getByLabelText('Reason'), 'Import the company register as at September');
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(3), KEY(3), KEY(4)]);
  expect(preparations()[1]).toEqual(preparations()[0]);
  expect(uploads()).toHaveLength(2);
});

it('shows why a preparation was refused and prepares the next attempt under a new operation id', async () => {
  prepareAnswer.mockRejectedValueOnce({
    response: { status: 400, data: ['Leave out former members who ceased before 2019-10-05.'] },
  });
  const view = await open();
  await complete(view);
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  expect(await view.findByText('Leave out former members who ceased before 2019-10-05.')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(3), KEY(4)]);
});

it('prepares nothing when an upload receipt cannot be confirmed, then uploads that file again under a new key', async () => {
  evidenceChanges = [{ fileSize: 4 }];
  const view = await open();
  await complete(view);
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  expect(await view.findByText(COPY.UPLOAD_RECEIPT_FAILED)).toBeTruthy();
  expect(preparations()).toEqual([]);
  expect(view.getByText('1.pdf')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(uploads().map(([, form]) => [field(form, 'kind'), field(form, 'idempotency_key')])).toEqual([
    ['share_register', KEY(1)],
    ['share_register', KEY(2)],
    ['asic_extract', KEY(3)],
  ]);
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(4)]);
});

it('retries an interrupted upload under its key and uploads a replacement file under a new one', async () => {
  uploadFailures = [new Error('Network Error'), new Error('Network Error')];
  const view = await open();
  await complete(view);
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  expect(await view.findByText(FAILED)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  await waitFor(() => expect(uploads()).toHaveLength(2));
  await view.findByText(FAILED);
  await fireEvent.press(view.getByRole('button', { name: 'Replace the share register' }));
  await view.findByText('3.pdf');
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(
    uploads().map(([, form]) => [(field(form, 'file') as { name: string }).name, field(form, 'idempotency_key')]),
  ).toEqual([
    ['1.pdf', KEY(1)],
    ['1.pdf', KEY(1)],
    ['3.pdf', KEY(2)],
    ['2.pdf', KEY(3)],
  ]);
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(4)]);
});

it('stays open and leaves the cached imports unchanged when the prepared import cannot be confirmed', async () => {
  prepareAnswer.mockImplementationOnce(async (body: RegisterImportPreparation) => ({
    data: { ...preparedFrom(body), members: preparedFrom(body).members.map((row) => ({ ...row, shares: '50' })) },
  }));
  const view = await open();
  const key = importsKey(getSessionEpoch(), 'ordinary');
  client.setQueryData(key, []);
  await complete(view);
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  expect(await view.findByText(COPY.PREPARATION_RECEIPT_FAILED)).toBeTruthy();
  expect(mockGoBack).not.toHaveBeenCalled();
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
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
  const key = importsKey(epoch, 'ordinary');
  client.setQueryData(key, []);
  await complete(view);
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  await waitFor(() => expect(answer).toBeDefined());
  await act(() => invalidateSessionScope());
  await act(async () => answer({ data: preparedFrom(preparations()[0]) }));
  expect(mockGoBack).not.toHaveBeenCalled();
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  expect(view.queryByText(FAILED)).toBeNull();
  await view.findByTestId('prepare-import-screen');
  expect(get).toHaveBeenLastCalledWith(APPOINTMENTS, expect.objectContaining({ ledovaSessionEpoch: epoch + 1 }));
});

it.each([
  ['a register reader', ['read_register']],
  ['an approver', ['approve']],
])('shows %s the read-only note instead of the preparation form', async (_, capabilities) => {
  appointments = [appointment('appointment-other', capabilities)];
  const view = await render(<PrepareRegisterImportScreen />, { wrapper });
  expect(await view.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Choose the share register' })).toBeNull();
  expect(view.queryByRole('button', { name: COPY.PREPARE })).toBeNull();
});

it('offers a retry instead of the form when the class cannot be read', async () => {
  readsFail = true;
  const view = await render(<PrepareRegisterImportScreen />, { wrapper });
  expect(await view.findByText('We couldn’t load this share class and your appointments.')).toBeTruthy();
  expect(view.queryByRole('button', { name: COPY.PREPARE })).toBeNull();
  readsFail = false;
  await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
  expect(await view.findByTestId('prepare-import-screen')).toBeTruthy();
});

it('notes that applying an import opens an unopened register, without calling the class off chain', async () => {
  holders = unopened;
  const view = await open();
  expect(view.getByText(COPY.NOT_ON_CHAIN_NOTE)).toBeTruthy();
  expect(view.getByText(ADD_MEMBERS)).toBeTruthy();
  expect(view.queryByText(/not yet on chain/)).toBeNull();
});

it('tells an opened class without current members that it has none to import, with nothing to add', async () => {
  holders = { ...opened, totalHolders: 0, holders: [] };
  const view = await open();
  expect(view.getByText(NO_HOLDERS)).toBeTruthy();
  expect(view.queryByText(ADD_MEMBERS)).toBeNull();
  expect(view.queryByRole('button', { name: 'Add a member' })).toBeNull();
  await chooseEvidence(view);
  expect(view.getAllByText(NO_HOLDERS)).toHaveLength(2);
  expect(view.queryByText('Add each current member of this class.')).toBeNull();
  expect(view.getByRole('button', { name: COPY.PREPARE })).toBeDisabled();
});

it('starts a fresh draft for a new session', async () => {
  holders = unopened;
  const view = await open();
  await fireEvent.press(view.getByRole('button', { name: 'Add a member' }));
  await fireEvent.changeText(view.getByLabelText('Member 1 name'), 'Casey Member');
  await fireEvent.changeText(view.getByLabelText('Reason'), 'Draft reason');
  await fireEvent.press(view.getByRole('button', { name: 'Choose the share register' }));
  await view.findByRole('button', { name: 'Replace the share register' });
  await act(() => invalidateSessionScope());
  await view.findByTestId('prepare-import-screen');
  expect(view.queryByLabelText('Member 1 name')).toBeNull();
  expect(view.getByLabelText('Reason').props.value).toBe('');
  expect(view.getByRole('button', { name: 'Choose the share register' })).toBeTruthy();
});

it.each([
  ['class', URLS.HOLDERS('ordinary')],
  ['appointments', APPOINTMENTS],
])('shows a new session no form until its own %s read answers', async (_, url) => {
  const view = await open();
  held = new Set([url]);
  await act(() => invalidateSessionScope());
  expect(await view.findByText('Loading the share class…')).toBeTruthy();
  expect(view.queryByTestId('prepare-import-screen')).toBeNull();
  expect(view.queryByText('Member ID member-1')).toBeNull();
});

it.each([
  [
    'a register date after today',
    'Register date',
    '2999-01-01',
    'Enter the register date as YYYY-MM-DD, no later than today.',
  ],
  [
    'a date entered after the register date',
    'Member 1 date entered',
    '2026-09-21',
    'Complete each current member’s name, residential address, shares and date entered, no later than the register date.',
  ],
  [
    'an amount paid with three decimal places',
    'Member 1 amount paid',
    '250.005',
    'Enter each amount paid as a plain amount such as 250.00, or leave it blank when it is not known.',
  ],
  [
    'no approving director for a resolution',
    'Approving director',
    ' ',
    'Name the director who approved the resolution.',
  ],
  ['no reason', 'Reason', ' ', 'Enter the authority reference and the reason for the import.'],
])('holds preparation for %s', async (_, label, value, problem) => {
  const view = await open();
  await complete(view);
  expect(view.getByRole('button', { name: COPY.PREPARE })).toBeEnabled();
  await fireEvent.changeText(view.getByLabelText(label), value);
  expect(view.getByText(problem)).toBeTruthy();
  expect(view.getByRole('button', { name: COPY.PREPARE })).toBeDisabled();
});

it('holds preparation until each added former member is complete', async () => {
  const view = await open();
  await complete(view);
  await fireEvent.press(view.getByRole('button', { name: 'Add a former member' }));
  expect(
    view.getByText(
      'Complete each former member’s name, residential address, shares and date ceased, no later than the register date.',
    ),
  ).toBeTruthy();
  expect(view.getByRole('button', { name: COPY.PREPARE })).toBeDisabled();
  const entries: [string, string][] = [
    ['Former member 1 name', 'Fred Former'],
    ['Former member 1 residential address', '2 Synthetic Road'],
    ['Former member 1 shares', '40'],
    ['Former member 1 date ceased', '2022-03-01'],
  ];
  for (const [entry, value] of entries) await fireEvent.changeText(view.getByLabelText(entry), value);
  expect(view.getByRole('button', { name: COPY.PREPARE })).toBeEnabled();
});

it('uploads a refused file again under a new key', async () => {
  uploadFailures = [{ response: { status: 400, data: ['Upload a PDF, PNG or JPEG file.'] } }];
  const view = await open();
  await complete(view);
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  expect(await view.findByText('Upload a PDF, PNG or JPEG file.')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: COPY.PREPARE }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(uploads().map(([, form]) => [field(form, 'kind'), field(form, 'idempotency_key')])).toEqual([
    ['share_register', KEY(1)],
    ['share_register', KEY(2)],
    ['asic_extract', KEY(3)],
  ]);
});

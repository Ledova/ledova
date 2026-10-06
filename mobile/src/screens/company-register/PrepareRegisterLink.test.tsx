import React from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  HOLDER_TYPE_LABELS,
  REGISTER_LINK_COPY as COPY,
  REGISTER_OPENING_COPY,
  type RegisterLinkPreparation,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import * as sessionScope from '../../services/sessionScope';
import { pickedFile, resetFiles } from '../../testSupport/documentFiles';
import { PrepareRegisterLinkScreen } from './PrepareRegisterLinkScreen';
import { linksKey } from './useCompanyRegister';

const mockGoBack = jest.fn();
const mockParams = { company: 'paper' };
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
type Wallet = { address: string; waiting: number; walletProof: string | null; holderType: string | null };
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const WAITING = URLS.REGISTER_LINK_WAITING_WALLETS;
const HOLDERS = URLS.HOLDERS('ordinary');
const UNMAPPED = 'Choose a member for each wallet.';
const CONFLICT = 'The register operation conflicts with its recorded identity.';
const ADA = '0xAdA0000000000000000000000000000000000a01';
const BEA = '0xBea0000000000000000000000000000000000b02';
const CY = '0xC000000000000000000000000000000000000c03';
const DEE = '0xDee0000000000000000000000000000000000d04';
const MEMBER_A = '10000000-0000-4000-8000-0000000000aa';
const MEMBER_B = '10000000-0000-4000-8000-0000000000bb';
const KEY = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const NEW_ONE = REGISTER_OPENING_COPY.NEW_MEMBER_NUMBERED(1);
const UNNAMED_ONE = REGISTER_OPENING_COPY.UNNAMED_MEMBER_NUMBERED(1);
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const pick = jest.mocked(DocumentPicker.getDocumentAsync);
const shareClass = (uuid: string, companyUuid: string, companyName: string) => ({
  uuid,
  name: `${uuid} shares`,
  symbol: uuid.slice(0, 3).toUpperCase(),
  companyUuid,
  companyName,
});
const holder = (member: string, name: string | null, holderType: string) => ({
  member,
  name,
  holderType,
  balance: '10',
  enteredOn: '2026-10-04',
  wallets: [],
});
const register = {
  token: { uuid: 'ordinary', name: 'ordinary shares', symbol: 'ORD', status: 'deployed', totalSupply: '1000' },
  issuedSupply: '20',
  initialized: true,
  waitingEffects: 4,
  totalHolders: 2,
  holders: [holder(MEMBER_A, 'Alex Member', 'member'), holder(MEMBER_B, null, 'unidentified')],
};
const wallet = (address: string, waiting: number, walletProof: string | null, holderType: string | null) => ({
  address,
  waiting,
  walletProof,
  holderType,
  holderName: holderType === 'member' ? 'Alex Member' : null,
});
const WALLETS: Wallet[] = [
  wallet(ADA, 2, 'proven', 'member'),
  wallet(BEA, 1, 'not_proven', 'unidentified'),
  wallet(CY, 1, null, null),
];
let client: QueryClient;
let wallets: Wallet[];
let appointments: unknown[];
let waitingAnswer: (() => Promise<unknown>) | null;
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
    createdAt: '2026-10-06T00:00:00Z',
    ...evidenceChanges.shift(),
  };
}

function preparedFrom(body: RegisterLinkPreparation) {
  return {
    uuid: body.operationId,
    company: body.companyId,
    mapping: [...body.mapping].reverse().map(({ address, member }) => ({ address: address.toLowerCase(), member })),
    mappingSummary: body.mapping.map(({ address, member }) => ({ address, member, memberExists: false })),
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
    reviewedBy: null,
    status: 'submitted',
    stage: 'submitted',
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    createdAt: '2026-10-06T00:00:00Z',
  };
}

const uploads = () => post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE);
const preparations = () =>
  post.mock.calls.filter(([url]) => url === URLS.REGISTER_LINKS).map(([, body]) => body as RegisterLinkPreparation);
const reads = (url: string) => get.mock.calls.filter(([called]) => called === url).length;
const submit = (view: Awaited<ReturnType<typeof render>>) =>
  fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
const settled = (view: Awaited<ReturnType<typeof render>>) =>
  waitFor(() => expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeEnabled());
const choose = (view: Awaited<ReturnType<typeof render>>, label: string, number: number) =>
  fireEvent.press(view.getByLabelText(`${label} for wallet ${number}`));
const text = (element: { props: { children?: unknown } }) => [element.props.children].flat().join('');
const entry = (view: Awaited<ReturnType<typeof render>>, number: number) =>
  within(view.getByText(`Wallet ${number}`).parent!);
const memberOf = (view: Awaited<ReturnType<typeof render>>, number: number) =>
  within(entry(view, number).getByText(COPY.MEMBER).parent!).getAllByText(/.+/).map(text)[1];
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function open() {
  const view = await render(<PrepareRegisterLinkScreen />, { wrapper });
  await view.findByTestId('prepare-link-screen');
  return view;
}

async function map(view: Awaited<ReturnType<typeof render>>) {
  await choose(view, 'Alex Member', 1);
  await choose(view, COPY.NEW_MEMBER, 2);
  await choose(view, NEW_ONE, 3);
}

async function complete(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(view.getByRole('button', { name: 'Choose the authority document' }));
  await view.findByRole('button', { name: 'Replace the authority document' });
  const entries: [string, string][] = [
    [COPY.APPROVING_DIRECTOR, ' Dana Director '],
    [COPY.AUTHORITY_REFERENCE, 'RESOLUTION-12'],
    [COPY.REASON, ' Link the wallets of the September subscribers '],
  ];
  for (const [label, value] of entries) await fireEvent.changeText(view.getByLabelText(label), value);
}

beforeEach(() => {
  resetFiles();
  append = jest.spyOn(FormData.prototype, 'append');
  wallets = WALLETS;
  appointments = [appointment('appointment-prepare', ['prepare'])];
  waitingAnswer = null;
  evidenceChanges = [];
  let keys = 0;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => KEY(++keys) as ReturnType<typeof Crypto.randomUUID>);
  let picks = 0;
  pick.mockReset().mockImplementation(async () => pickedFile(++picks));
  mockGoBack.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  get.mockReset().mockImplementation(async (url) => {
    if (url === URLS.REGISTER)
      return {
        data: {
          results: [shareClass('ordinary', 'paper', 'Paper Company'), shareClass('growth', 'garden', 'Garden Company')],
          next: null,
          count: 2,
        },
      };
    if (url === HOLDERS) return { data: register };
    if (url === WAITING) return waitingAnswer?.() ?? { data: { wallets } };
    if (url === APPOINTMENTS) return { data: { results: appointments, next: null, count: appointments.length } };
    throw new Error(`Unexpected ${url}`);
  });
  prepareAnswer = jest.fn(async (body: RegisterLinkPreparation) => ({ data: preparedFrom(body) }));
  post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_EVIDENCE) return { data: evidenceFor(body) };
    if (url === URLS.REGISTER_LINKS) return prepareAnswer(body);
    throw new Error(`Unexpected ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

it('maps each waiting wallet to a member it never guesses, uploads the authority document and prepares exactly that link', async () => {
  const view = await open();
  const epoch = sessionScope.getSessionEpoch();
  const session = { ledovaSessionEpoch: epoch, signal: expect.objectContaining({ aborted: false }) };
  expect(get).toHaveBeenCalledWith(URLS.REGISTER, { ...session, params: { page: 1 } });
  expect(get).toHaveBeenCalledWith(HOLDERS, session);
  expect(get).toHaveBeenCalledWith(WAITING, { ...session, params: { company: 'paper' } });
  expect(get).toHaveBeenCalledWith(APPOINTMENTS, { ...session, params: { page: 1 } });
  expect(reads(URLS.HOLDERS('growth'))).toBe(0);
  client.setQueryData(linksKey(epoch, 'paper'), []);
  expect(view.getByText(`${COPY.PREPARE} for Paper Company.`)).toBeTruthy();
  for (const note of [COPY.MAPPING_NOTE, COPY.STATUS_NOTE, COPY.AUTHORITY_DOCUMENT_NOTE])
    expect(view.getByText(note)).toBeTruthy();
  const first = entry(view, 1);
  for (const shown of [ADA, COPY.WAITING(2), COPY.WALLET_PROOF.proven]) expect(first.getByText(shown)).toBeTruthy();
  expect(within(first.getByText(COPY.HOLDER).parent!).getByText('Alex Member')).toBeTruthy();
  expect(entry(view, 2).getByText(COPY.WALLET_PROOF.not_proven)).toBeTruthy();
  expect(within(entry(view, 2).getByText(COPY.HOLDER).parent!).getByText(HOLDER_TYPE_LABELS.unidentified)).toBeTruthy();
  expect(entry(view, 3).getByText(COPY.NO_STATUS)).toBeTruthy();
  expect([1, 2, 3].map((number) => memberOf(view, number))).toEqual([
    'Not chosen yet',
    'Not chosen yet',
    'Not chosen yet',
  ]);
  expect(view.getByLabelText('Alex Member for wallet 1').props.accessibilityState).toEqual(
    expect.objectContaining({ checked: false }),
  );
  expect(view.getByLabelText(`${UNNAMED_ONE} for wallet 1`)).toBeTruthy();
  expect(view.getByText(UNMAPPED)).toBeTruthy();
  await map(view);
  expect([1, 2, 3].map((number) => memberOf(view, number))).toEqual(['Alex Member', NEW_ONE, NEW_ONE]);
  expect(view.queryByText(UNMAPPED)).toBeNull();
  const named = [...view.getAllByRole('button'), ...view.getAllByRole('radio')].filter(
    (node) => typeof node.props.accessibilityLabel === 'string',
  );
  for (const node of named)
    for (const shown of within(node).getAllByText(/.+/).map(text))
      expect(String(node.props.accessibilityLabel)).toContain(shown);
  expect(
    named
      .map((node) => String(node.props.accessibilityLabel))
      .filter((name) => /0x|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name)),
  ).toEqual([]);
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  await complete(view);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  const [upload] = uploads();
  expect(parts(upload[1])).toEqual([
    ['company_id', 'paper'],
    ['appointment', 'appointment-prepare'],
    ['kind', 'authority'],
    ['idempotency_key', KEY(2)],
    ['file', expect.objectContaining({ name: '1.pdf', type: 'application/pdf' })],
  ]);
  expect(upload[2]).toEqual({
    ledovaSessionEpoch: epoch,
    ledovaSubmissionGuard: expect.any(Function),
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  expect(post).toHaveBeenLastCalledWith(
    URLS.REGISTER_LINKS,
    {
      operationId: KEY(3),
      appointment: 'appointment-prepare',
      companyId: 'paper',
      authorityEvidence: 'evidence-authority',
      mapping: [
        { address: ADA, member: MEMBER_A },
        { address: BEA, member: KEY(1) },
        { address: CY, member: KEY(1) },
      ],
      authority: 'director_resolution',
      approvingDirector: 'Dana Director',
      authorityReference: 'RESOLUTION-12',
      reason: 'Link the wallets of the September subscribers',
    },
    { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: expect.any(Function) },
  );
  expect(client.getQueryState(linksKey(epoch, 'paper'))?.isInvalidated).toBe(true);
});

it.each([
  ['an administrator', ['admin'], 'paper', true],
  ['an approver', ['approve'], 'paper', false],
  ['an appointee who applies', ['apply'], 'paper', false],
  ['a register reader', ['read_register'], 'paper', false],
  ['another company’s preparer', ['prepare'], 'garden', false],
])('decides by its own appointments whether %s may prepare', async (_, capabilities, company, prepares) => {
  appointments = [appointment('appointment-step', capabilities, { company })];
  const view = await render(<PrepareRegisterLinkScreen />, { wrapper });
  expect(await view.findByText(`${COPY.PREPARE} for Paper Company.`)).toBeTruthy();
  if (prepares) await view.findByTestId('prepare-link-screen');
  expect(!!view.queryByTestId('prepare-link-screen')).toBe(prepares);
  expect(!!view.queryByText(COPY.READ_ONLY_NOTE)).toBe(!prepares);
  expect(reads(WAITING)).toBe(prepares ? 1 : 0);
});

it('retries an interrupted preparation under its operation id with the confirmed upload, and a changed mapping takes a new id', async () => {
  prepareAnswer.mockRejectedValueOnce(new Error('Network Error')).mockRejectedValueOnce(new Error('Network Error'));
  const view = await open();
  await map(view);
  await complete(view);
  await submit(view);
  await waitFor(() => expect(preparations()).toHaveLength(1));
  await settled(view);
  expect(view.getByText('1.pdf · uploaded')).toBeTruthy();
  await submit(view);
  await waitFor(() => expect(preparations()).toHaveLength(2));
  await settled(view);
  await choose(view, COPY.NEW_MEMBER, 1);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(3), KEY(3), KEY(5)]);
  expect(preparations()[1]).toEqual(preparations()[0]);
  expect(preparations()[2].mapping[0]).toEqual({ address: ADA, member: KEY(4) });
  expect(uploads()).toHaveLength(1);
});

it('reads the wallets, members and appointments again after a conflict, keeps each choice by address and takes a new operation id', async () => {
  prepareAnswer.mockRejectedValueOnce({ response: { status: 409, data: { detail: CONFLICT } } });
  const view = await open();
  await map(view);
  await complete(view);
  const before = [reads(WAITING), reads(HOLDERS), reads(APPOINTMENTS)];
  wallets = [wallet(DEE, 3, null, null), WALLETS[1], WALLETS[0]];
  await submit(view);
  expect(await view.findByText(CONFLICT)).toBeTruthy();
  await waitFor(() =>
    [reads(WAITING), reads(HOLDERS), reads(APPOINTMENTS)].forEach((count, index) =>
      expect(count).toBeGreaterThan(before[index]),
    ),
  );
  expect(await view.findByText(DEE)).toBeTruthy();
  expect(view.queryByText(CY)).toBeNull();
  expect([1, 2, 3].map((number) => memberOf(view, number))).toEqual(['Not chosen yet', NEW_ONE, 'Alex Member']);
  expect(view.getByText(COPY.CHOICES_RESET)).toBeTruthy();
  expect(view.getByText(UNMAPPED)).toBeTruthy();
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  await choose(view, NEW_ONE, 1);
  expect(view.queryByText(COPY.CHOICES_RESET)).toBeNull();
  await settled(view);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(3), KEY(4)]);
  expect(preparations()[1].mapping).toEqual([
    { address: DEE, member: KEY(1) },
    { address: BEA, member: KEY(1) },
    { address: ADA, member: MEMBER_A },
  ]);
});

it.each<[string, typeof Platform.OS, string[][]]>([
  ['iOS', 'ios', [[COPY.CHOICES_RESET]]],
  ['Android', 'android', []],
])(
  'says on %s that a re-read reset some choices, in a polite live region, until the link is prepared',
  async (_, os, announced) => {
    jest.replaceProperty(Platform, 'OS', os);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    let answer!: (value: unknown) => void;
    prepareAnswer
      .mockRejectedValueOnce({ response: { status: 409, data: { detail: CONFLICT } } })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      );
    const view = await open();
    await map(view);
    await complete(view);
    expect(view.queryByText(COPY.CHOICES_RESET)).toBeNull();
    wallets = [WALLETS[0], WALLETS[1]];
    await submit(view);
    const note = await view.findByText(COPY.CHOICES_RESET);
    expect(note.props.accessibilityLiveRegion).toBe('polite');
    await fireEvent.changeText(view.getByLabelText(COPY.REASON), 'Link the September subscribers');
    expect(view.getByText(COPY.CHOICES_RESET)).toBeTruthy();
    await settled(view);
    await submit(view);
    await waitFor(() => expect(answer).toBeDefined());
    expect(view.queryByText(COPY.CHOICES_RESET)).toBeNull();
    await act(async () => answer({ data: preparedFrom(preparations()[1]) }));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
    expect(preparations()[1].mapping).toEqual([
      { address: ADA, member: MEMBER_A },
      { address: BEA, member: KEY(1) },
    ]);
    expect(announce.mock.calls).toEqual(announced);
  },
);

it('shows a refusal in the server’s words, reads nothing again and prepares the next attempt under a new operation id', async () => {
  const refusal = 'A mapped wallet address is already linked to a member of this company.';
  prepareAnswer.mockRejectedValueOnce({ response: { status: 400, data: [refusal] } });
  const view = await open();
  await map(view);
  await complete(view);
  const before = [reads(WAITING), reads(HOLDERS), reads(APPOINTMENTS)];
  await submit(view);
  expect(await view.findByText(refusal)).toBeTruthy();
  expect([reads(WAITING), reads(HOLDERS), reads(APPOINTMENTS)]).toEqual(before);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(3), KEY(4)]);
});

it('reads the appointments again after a refused preparation and withdraws the form once the appointment is gone', async () => {
  prepareAnswer.mockRejectedValueOnce({ response: { status: 404, data: { detail: 'Not found.' } } });
  const view = await open();
  await map(view);
  await complete(view);
  const before = reads(APPOINTMENTS);
  appointments = [];
  await submit(view);
  expect(await view.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(reads(APPOINTMENTS)).toBe(before + 1);
  expect(view.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
});

it('reads the appointments again after a refused waiting-wallets read and withdraws the form once the appointment is gone', async () => {
  let refuse!: (reason: unknown) => void;
  waitingAnswer = () =>
    new Promise((_, reject) => {
      refuse = reject;
    });
  const view = await render(<PrepareRegisterLinkScreen />, { wrapper });
  expect(await view.findByText('Reading the waiting wallets…')).toBeTruthy();
  appointments = [];
  await act(async () => refuse({ response: { status: 404, data: { detail: 'Not found.' } } }));
  expect(await view.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(reads(APPOINTMENTS)).toBe(2);
});

it.each([
  ['another member for an address', { mapping: [{ address: ADA, member: MEMBER_B }] }],
  ['another company', { company: 'garden' }],
  ['a staff-era provenance', { providedBy: 'staff_verified' }],
])('stays open and leaves the wallet links unread when the prepared link names %s', async (_, changes) => {
  prepareAnswer.mockImplementationOnce(async (body: RegisterLinkPreparation) => ({
    data: { ...preparedFrom(body), ...changes },
  }));
  const view = await open();
  const key = linksKey(sessionScope.getSessionEpoch(), 'paper');
  client.setQueryData(key, []);
  await map(view);
  await complete(view);
  await submit(view);
  expect(await view.findByText(COPY.PREPARATION_RECEIPT_FAILED)).toBeTruthy();
  expect(mockGoBack).not.toHaveBeenCalled();
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(3), KEY(3)]);
});

it('prepares nothing when the upload receipt cannot be confirmed, then uploads the file again under a new key', async () => {
  evidenceChanges = [{ kind: 'supporting' }];
  const view = await open();
  await map(view);
  await complete(view);
  await submit(view);
  expect(await view.findByText(COPY.UPLOAD_RECEIPT_FAILED)).toBeTruthy();
  expect(preparations()).toEqual([]);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(uploads().map(([, form]) => field(form, 'idempotency_key'))).toEqual([KEY(2), KEY(3)]);
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(4)]);
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
  const key = linksKey(epoch, 'paper');
  client.setQueryData(key, []);
  await map(view);
  await complete(view);
  await submit(view);
  await waitFor(() => expect(answer).toBeDefined());
  await act(() => sessionScope.invalidateSessionScope());
  await act(async () => answer({ data: preparedFrom(preparations()[0]) }));
  expect(mockGoBack).not.toHaveBeenCalled();
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  await view.findByTestId('prepare-link-screen');
  expect(get).toHaveBeenCalledWith(WAITING, expect.objectContaining({ ledovaSessionEpoch: epoch + 1 }));
  expect([1, 2, 3].map((number) => memberOf(view, number))).toEqual([
    'Not chosen yet',
    'Not chosen yet',
    'Not chosen yet',
  ]);
  expect(view.getByLabelText(COPY.REASON).props.value).toBe('');
  expect(view.getByRole('button', { name: 'Choose the authority document' })).toBeTruthy();
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
  const key = linksKey(sessionScope.getSessionEpoch(), 'paper');
  client.setQueryData(key, []);
  await map(view);
  await complete(view);
  await submit(view);
  await waitFor(() => expect(answer).toBeDefined());
  sessionScope.invalidateSessionScope();
  await act(async () => answer({ data: preparedFrom(preparations()[0]) }));
  expect(mockGoBack).not.toHaveBeenCalled();
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
});

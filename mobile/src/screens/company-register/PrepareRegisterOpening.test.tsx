import React from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_OPENING_COPY as COPY,
  REGISTER_OPENING_HOLDINGS_MOVED_CODE,
  type RegisterOpeningPreparation,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { files, pickedFile, resetFiles } from '../../testSupport/documentFiles';
import { PrepareRegisterOpeningScreen } from './PrepareRegisterOpeningScreen';
import { openingHoldersKey, openingsKey, registerAppointmentsKey } from './useCompanyRegister';

const mockGoBack = jest.fn();
const mockParams = { tokenUuid: 'ordinary', companyUuid: 'paper' };
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
type Holding = { address: string; shares: string; member: string | null; memberName: string | null };
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const HOLDINGS_URL = URLS.REGISTER_OPENING_HOLDERS('ordinary');
const FAILED = 'The opening could not be prepared. Retry with the same details.';
const MOVED = 'The mapping no longer covers the addresses holding shares.';
const UNMAPPED = 'Choose a member for each holding.';
const movedRefusal = () => ({
  response: { status: 400, data: { detail: MOVED, code: REGISTER_OPENING_HOLDINGS_MOVED_CODE } },
});
const ADA = '0xAdA0000000000000000000000000000000000a01';
const BEA = '0xBea0000000000000000000000000000000000b02';
const CY = '0xC000000000000000000000000000000000000c03';
const DEE = '0xDee0000000000000000000000000000000000d04';
const EVE = '0xEee0000000000000000000000000000000000e05';
const MEMBER_A = '10000000-0000-4000-8000-0000000000aa';
const MEMBER_B = '10000000-0000-4000-8000-0000000000bb';
const KEY = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const pick = jest.mocked(DocumentPicker.getDocumentAsync);
const register = {
  token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'deployed', totalSupply: '1000' },
  issuedSupply: null,
  initialized: false,
  waitingEffects: null,
  totalHolders: 0,
  holders: [],
};
const holding = (address: string, shares: string, member: string | null = null, memberName: string | null = null) => ({
  address,
  shares,
  member,
  memberName,
  memberExists: member !== null,
});
const BLOCK = { number: 1234, hash: `0x${'c'.repeat(64)}`, date: '2026-10-04' };
const HOLDINGS: Holding[] = [
  holding(ADA, '9007199254740993', MEMBER_A, 'Alex Member'),
  holding(BEA, '40'),
  holding(CY, '7'),
  holding(DEE, '1'),
];
let client: QueryClient;
let holdings: Holding[];
let appointments: unknown[];
let readsFail: boolean;
let failing: Set<string>;
let held: Set<string>;
let holdingsAnswer: (() => Promise<unknown>) | null;
let evidenceChanges: object[];
let uploadAnswer: ((form: unknown) => Promise<unknown>) | null;
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

function preparedFrom(body: RegisterOpeningPreparation) {
  return {
    uuid: body.operationId,
    company: 'paper',
    token: body.tokenId,
    mapping: [...body.mapping].reverse().map(({ address, member }) => ({ address: address.toLowerCase(), member })),
    boundary: {},
    boundarySummary: { blockNumber: 1240, blockHash: `0x${'d'.repeat(64)}`, date: '2026-10-05', holdings: [] },
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
    .filter(([url]) => url === URLS.REGISTER_OPENINGS)
    .map(([, body]) => body as RegisterOpeningPreparation);
const reads = (url: string) => get.mock.calls.filter(([called]) => called === url).length;
const holdingReads = () =>
  get.mock.calls
    .filter(([called]) => called === HOLDINGS_URL)
    .map(([, config]) => config as { ledovaSessionEpoch: number; signal: AbortSignal });
const submit = (view: Awaited<ReturnType<typeof render>>) =>
  fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
const choose = (view: Awaited<ReturnType<typeof render>>, label: string, number: number) =>
  fireEvent.press(view.getByLabelText(`${label} for holding ${number}`));
const text = (element: { props: { children?: unknown } }) => [element.props.children].flat().join('');
const memberOf = (view: Awaited<ReturnType<typeof render>>, number: number) => {
  const row = within(view.getByText(`Holding ${number}`).parent!).getByText(COPY.MEMBER).parent!;
  return within(row).getAllByText(/.+/).map(text)[1];
};
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function open() {
  const view = await render(<PrepareRegisterOpeningScreen />, { wrapper });
  await view.findByTestId('prepare-opening-screen');
  return view;
}

async function map(view: Awaited<ReturnType<typeof render>>) {
  await choose(view, COPY.NEW_MEMBER, 2);
  await choose(view, COPY.NEW_MEMBER_NUMBERED(1), 3);
  await choose(view, 'Alex Member', 4);
}

async function complete(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(view.getByRole('button', { name: 'Choose the authority document' }));
  await view.findByRole('button', { name: 'Replace the authority document' });
  const entries: [string, string][] = [
    [COPY.APPROVING_DIRECTOR, ' Dana Director '],
    [COPY.AUTHORITY_REFERENCE, 'RESOLUTION-9'],
    [COPY.REASON, ' Open the register from the chain '],
  ];
  for (const [label, value] of entries) await fireEvent.changeText(view.getByLabelText(label), value);
}

beforeEach(() => {
  resetFiles();
  append = jest.spyOn(FormData.prototype, 'append');
  holdings = HOLDINGS;
  appointments = [appointment('appointment-prepare', ['prepare'])];
  readsFail = false;
  failing = new Set();
  held = new Set();
  holdingsAnswer = null;
  evidenceChanges = [];
  uploadAnswer = null;
  let keys = 0;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => KEY(++keys) as ReturnType<typeof Crypto.randomUUID>);
  let picks = 0;
  pick.mockReset().mockImplementation(async () => pickedFile(++picks));
  mockGoBack.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  get.mockReset().mockImplementation(async (url) => {
    if (readsFail || failing.has(url)) throw new Error('Unavailable');
    if (held.has(url)) return new Promise(() => {}) as ReturnType<typeof get>;
    if (url === URLS.HOLDERS('ordinary')) return { data: register };
    if (url === APPOINTMENTS) return { data: { results: appointments, next: null, count: appointments.length } };
    if (url === HOLDINGS_URL) return holdingsAnswer?.() ?? { data: { block: BLOCK, holdings } };
    throw new Error(`Unexpected ${url}`);
  });
  prepareAnswer = jest.fn(async (body: RegisterOpeningPreparation) => ({ data: preparedFrom(body) }));
  post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_EVIDENCE) return uploadAnswer?.(body) ?? { data: evidenceFor(body) };
    if (url === URLS.REGISTER_OPENINGS) return prepareAnswer(body);
    throw new Error(`Unexpected ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

it('reads the holdings on chain, maps each to a member, uploads the authority document and prepares exactly that opening', async () => {
  const view = await open();
  const epoch = getSessionEpoch();
  const session = { ledovaSessionEpoch: epoch, signal: expect.objectContaining({ aborted: false }) };
  expect(get).toHaveBeenCalledWith(URLS.HOLDERS('ordinary'), session);
  expect(get).toHaveBeenCalledWith(APPOINTMENTS, { ...session, params: { page: 1 } });
  expect(holdingReads()).toEqual([session]);
  client.setQueryData(openingsKey(epoch, 'ordinary'), []);
  expect(view.getByText(`${COPY.PREPARE} for Ordinary shares.`)).toBeTruthy();
  expect(within(view.getByText('Read at').parent!).getByText(COPY.BOUNDARY_BLOCK(1234, '4 October 2026'))).toBeTruthy();
  expect(view.getByText(COPY.BOUNDARY_NOTE)).toBeTruthy();
  expect(view.getByText(COPY.HOLDINGS_NOTE)).toBeTruthy();
  expect(view.getByText(COPY.AUTHORITY_DOCUMENT_NOTE)).toBeTruthy();
  const linked = within(view.getByText('Holding 1').parent!);
  expect(linked.getByText(ADA)).toBeTruthy();
  expect(linked.getByText('9,007,199,254,740,993 shares')).toBeTruthy();
  expect(linked.getByText('Alex Member')).toBeTruthy();
  expect(linked.getByText(COPY.LINKED_NOTE)).toBeTruthy();
  expect(view.queryByLabelText(`${COPY.NEW_MEMBER} for holding 1`)).toBeNull();
  expect(within(view.getByText('Holding 4').parent!).getByText('1 share')).toBeTruthy();
  expect(view.getAllByText('Not chosen yet')).toHaveLength(3);
  expect(view.getByText(UNMAPPED)).toBeTruthy();
  expect(view.getByLabelText('Alex Member for holding 2').props.accessibilityState).toEqual(
    expect.objectContaining({ checked: false }),
  );
  await map(view);
  expect(memberOf(view, 2)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  expect(memberOf(view, 3)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  expect(memberOf(view, 4)).toBe('Alex Member');
  expect(view.getByLabelText(`${COPY.NEW_MEMBER_NUMBERED(1)} for holding 3`).props.accessibilityState).toEqual(
    expect.objectContaining({ checked: true }),
  );
  expect(view.getByLabelText('Alex Member for holding 4').props.accessibilityState).toEqual(
    expect.objectContaining({ checked: true }),
  );
  expect(view.queryByText('Not chosen yet')).toBeNull();
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
    URLS.REGISTER_OPENINGS,
    {
      operationId: KEY(3),
      appointment: 'appointment-prepare',
      tokenId: 'ordinary',
      authorityEvidence: 'evidence-authority',
      mapping: [
        { address: ADA, member: MEMBER_A },
        { address: BEA, member: KEY(1) },
        { address: CY, member: KEY(1) },
        { address: DEE, member: MEMBER_A },
      ],
      authority: 'director_resolution',
      approvingDirector: 'Dana Director',
      authorityReference: 'RESOLUTION-9',
      reason: 'Open the register from the chain',
    },
    { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: expect.any(Function) },
  );
  expect(client.getQueryState(openingsKey(epoch, 'ordinary'))?.isInvalidated).toBe(true);
  expect([...files.keys()].some((uri) => uri.includes('ledova-upload-copies'))).toBe(false);
});

it('dates the block the holdings were read at by its calendar day for a reader west of UTC', async () => {
  const format = Date.prototype.toLocaleDateString;
  jest.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (this: Date, locale, options) {
    return format.call(this, locale, { timeZone: 'America/Los_Angeles', ...options });
  });
  const view = await open();
  expect(within(view.getByText('Read at').parent!).getByText(COPY.BOUNDARY_BLOCK(1234, '4 October 2026'))).toBeTruthy();
});

it('names every choice by its visible text and holding, never by an address or ID', async () => {
  const view = await open();
  await map(view);
  const named = [...view.getAllByRole('button'), ...view.getAllByRole('radio')].filter(
    (node) => typeof node.props.accessibilityLabel === 'string',
  );
  const names = named.map((node) => String(node.props.accessibilityLabel));
  expect(names).toEqual(
    expect.arrayContaining([
      'Alex Member for holding 2',
      `${COPY.NEW_MEMBER_NUMBERED(1)} for holding 2`,
      `${COPY.NEW_MEMBER} for holding 2`,
      `${COPY.NEW_MEMBER} for holding 4`,
    ]),
  );
  for (const node of named)
    for (const shown of within(node).getAllByText(/.+/).map(text))
      expect(String(node.props.accessibilityLabel)).toContain(shown);
  expect(names.filter((name) => /0x[0-9a-f]{6}|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name))).toEqual([]);
});

it('numbers new members by first holding, shares one across holdings and names an unnamed linked member neutrally', async () => {
  holdings = [holding(ADA, '50'), holding(BEA, '30', MEMBER_B, null), holding(CY, '20')];
  const view = await open();
  expect(within(view.getByText('Holding 2').parent!).getByText(COPY.UNNAMED_MEMBER_NUMBERED(1))).toBeTruthy();
  expect(within(view.getByText('Holding 2').parent!).getByText(COPY.LINKED_NOTE)).toBeTruthy();
  await choose(view, COPY.NEW_MEMBER, 3);
  expect(memberOf(view, 3)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  await choose(view, COPY.NEW_MEMBER, 1);
  expect(memberOf(view, 1)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  expect(memberOf(view, 3)).toBe(COPY.NEW_MEMBER_NUMBERED(2));
  await choose(view, COPY.NEW_MEMBER_NUMBERED(2), 1);
  expect(memberOf(view, 1)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  expect(memberOf(view, 3)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  expect(view.queryByLabelText(`${COPY.NEW_MEMBER_NUMBERED(2)} for holding 1`)).toBeNull();
  await choose(view, COPY.UNNAMED_MEMBER_NUMBERED(1), 3);
  await complete(view);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations()[0].mapping).toEqual([
    { address: ADA, member: KEY(1) },
    { address: BEA, member: MEMBER_B },
    { address: CY, member: MEMBER_B },
  ]);
});

it('prepares under a court order without an approving director', async () => {
  const view = await open();
  await map(view);
  await complete(view);
  await fireEvent.press(view.getByRole('radio', { name: COPY.AUTHORITIES.court_order }));
  expect(view.queryByLabelText(COPY.APPROVING_DIRECTOR)).toBeNull();
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations()).toEqual([expect.objectContaining({ authority: 'court_order', approvingDirector: '' })]);
});

it('prepares an opening with an empty mapping when no address holds shares', async () => {
  holdings = [];
  const view = await open();
  expect(view.getByText(COPY.NO_HOLDINGS)).toBeTruthy();
  expect(view.queryByText(UNMAPPED)).toBeNull();
  await complete(view);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations()).toEqual([expect.objectContaining({ mapping: [] })]);
});

it.each([
  ['no authority document', null, 'Choose the authority document.'],
  ['no approving director', COPY.APPROVING_DIRECTOR, 'Name the director who approved the resolution.'],
  ['no authority reference', COPY.AUTHORITY_REFERENCE, 'Enter the authority reference and the reason for the opening.'],
  ['no reason', COPY.REASON, 'Enter the authority reference and the reason for the opening.'],
])('holds preparation for %s', async (_, label, problem) => {
  const view = await open();
  await map(view);
  await complete(view);
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeEnabled();
  if (label) await fireEvent.changeText(view.getByLabelText(label), ' ');
  else await fireEvent.press(view.getByRole('button', { name: 'Remove the authority document' }));
  expect(view.getByText(problem)).toBeTruthy();
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  await submit(view);
  expect(post).not.toHaveBeenCalled();
});

it('holds preparation until every holding has a member', async () => {
  holdings = [...HOLDINGS, holding(EVE, '2')];
  const view = await open();
  await map(view);
  await complete(view);
  expect(view.getByText(UNMAPPED)).toBeTruthy();
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  await submit(view);
  expect(post).not.toHaveBeenCalled();
  await choose(view, COPY.NEW_MEMBER, 5);
  expect(view.queryByText(UNMAPPED)).toBeNull();
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeEnabled();
});

it('limits each authority field to the length the API accepts', async () => {
  const view = await open();
  expect(view.getByLabelText(COPY.APPROVING_DIRECTOR).props.maxLength).toBe(255);
  expect(view.getByLabelText(COPY.AUTHORITY_REFERENCE).props.maxLength).toBe(255);
  expect(view.getByLabelText(COPY.REASON).props.maxLength).toBe(1000);
});

it('retries an interrupted preparation under its operation id with the confirmed upload, and a changed mapping takes a new id', async () => {
  prepareAnswer.mockRejectedValueOnce(new Error('Network Error')).mockRejectedValueOnce(new Error('Network Error'));
  const view = await open();
  await map(view);
  await complete(view);
  await submit(view);
  expect(await view.findByText(FAILED)).toBeTruthy();
  expect(view.getByText('1.pdf · uploaded')).toBeTruthy();
  await submit(view);
  await waitFor(() => expect(preparations()).toHaveLength(2));
  await view.findByText(FAILED);
  await choose(view, COPY.NEW_MEMBER, 4);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(3), KEY(3), KEY(5)]);
  expect(preparations()[1]).toEqual(preparations()[0]);
  expect(preparations()[2].mapping[3]).toEqual({ address: DEE, member: KEY(4) });
  expect(uploads()).toHaveLength(1);
});

it('reads the holdings and appointments again after a conflict and prepares under a new operation id', async () => {
  prepareAnswer.mockRejectedValueOnce({
    response: { status: 409, data: { detail: 'The register operation conflicts with its recorded identity.' } },
  });
  const view = await open();
  await map(view);
  await complete(view);
  const before = [reads(HOLDINGS_URL), reads(APPOINTMENTS)];
  await submit(view);
  expect(await view.findByText('The register operation conflicts with its recorded identity.')).toBeTruthy();
  await waitFor(() => expect(reads(HOLDINGS_URL)).toBeGreaterThan(before[0]));
  expect(reads(APPOINTMENTS)).toBeGreaterThan(before[1]);
  expect(view.queryByText(COPY.HOLDINGS_MOVED)).toBeNull();
  await waitFor(() => expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeEnabled());
  expect(view.queryByText(COPY.CHOICES_RESET)).toBeNull();
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(3), KEY(4)]);
  expect(preparations()[1].mapping).toEqual(preparations()[0].mapping);
});

it('says the holdings moved when the server refuses the mapping, and maps the reloaded holdings again', async () => {
  prepareAnswer.mockRejectedValueOnce(movedRefusal());
  const view = await open();
  await map(view);
  await complete(view);
  await submit(view);
  expect(await view.findByText(MOVED)).toBeTruthy();
  expect(view.getByText(COPY.HOLDINGS_MOVED)).toBeTruthy();
  const before = reads(HOLDINGS_URL);
  holdings = [holding(ADA, '9007199254740993', MEMBER_A, 'Alex Member'), holding(BEA, '41'), holding(EVE, '6')];
  await fireEvent.press(view.getByRole('button', { name: COPY.RELOAD_HOLDINGS }));
  await waitFor(() => expect(reads(HOLDINGS_URL)).toBe(before + 1));
  await waitFor(() => expect(view.queryByText(MOVED)).toBeNull());
  expect(view.queryByText(COPY.HOLDINGS_MOVED)).toBeNull();
  expect(await view.findByText('41 shares')).toBeTruthy();
  expect(view.queryByText(CY)).toBeNull();
  expect(memberOf(view, 2)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  expect(memberOf(view, 3)).toBe('Not chosen yet');
  expect(view.getByText(UNMAPPED)).toBeTruthy();
  expect(view.getByText(COPY.CHOICES_RESET)).toBeTruthy();
  await choose(view, COPY.NEW_MEMBER_NUMBERED(1), 3);
  expect(view.queryByText(COPY.CHOICES_RESET)).toBeNull();
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(3), KEY(4)]);
  expect(preparations()[1].mapping).toEqual([
    { address: ADA, member: MEMBER_A },
    { address: BEA, member: KEY(1) },
    { address: EVE, member: KEY(1) },
  ]);
});

it('shows another refusal as the server words it, without saying the holdings moved', async () => {
  prepareAnswer.mockRejectedValueOnce({
    response: { status: 400, data: ['A mapped wallet address already belongs to another member of this company.'] },
  });
  const view = await open();
  await map(view);
  await complete(view);
  const before = reads(HOLDINGS_URL);
  await submit(view);
  expect(
    await view.findByText('A mapped wallet address already belongs to another member of this company.'),
  ).toBeTruthy();
  expect(reads(APPOINTMENTS)).toBe(1);
  expect(view.queryByText(COPY.HOLDINGS_MOVED)).toBeNull();
  expect(view.queryByRole('button', { name: COPY.RELOAD_HOLDINGS })).toBeNull();
  expect(reads(HOLDINGS_URL)).toBe(before);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations().map(({ operationId }) => operationId)).toEqual([KEY(3), KEY(4)]);
});

it('says nothing of moved holdings when a refusal lacks the holdings-moved code, whatever its words', async () => {
  prepareAnswer.mockRejectedValueOnce({ response: { status: 400, data: { detail: MOVED } } });
  const view = await open();
  await map(view);
  await complete(view);
  await submit(view);
  expect(await view.findByText(MOVED)).toBeTruthy();
  expect(view.queryByText(COPY.HOLDINGS_MOVED)).toBeNull();
  expect(view.queryByRole('button', { name: COPY.RELOAD_HOLDINGS })).toBeNull();
});

it('forgets a choice of a linked member that no longer holds once the holdings are reloaded', async () => {
  prepareAnswer.mockRejectedValueOnce(movedRefusal());
  const view = await open();
  await map(view);
  await complete(view);
  await submit(view);
  await view.findByText(COPY.HOLDINGS_MOVED);
  holdings = [holding(BEA, '40'), holding(CY, '7'), holding(DEE, '1')];
  await fireEvent.press(view.getByRole('button', { name: COPY.RELOAD_HOLDINGS }));
  await waitFor(() => expect(view.queryByText(ADA)).toBeNull());
  expect(memberOf(view, 1)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  expect(memberOf(view, 2)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  expect(memberOf(view, 3)).toBe('Not chosen yet');
  expect(view.queryByLabelText('Alex Member for holding 3')).toBeNull();
  expect(view.getByText(COPY.CHOICES_RESET)).toBeTruthy();
});

it('drops the choice of an address that is now linked, says so, and keeps the others', async () => {
  prepareAnswer.mockRejectedValueOnce(movedRefusal());
  const view = await open();
  await map(view);
  await complete(view);
  await submit(view);
  await view.findByText(COPY.HOLDINGS_MOVED);
  holdings = [HOLDINGS[0], holding(BEA, '40', MEMBER_B, 'Blair Member'), HOLDINGS[2], HOLDINGS[3]];
  await fireEvent.press(view.getByRole('button', { name: COPY.RELOAD_HOLDINGS }));
  expect(await view.findByText(COPY.CHOICES_RESET)).toBeTruthy();
  expect(memberOf(view, 2)).toBe('Blair Member');
  expect(view.queryByLabelText(`${COPY.NEW_MEMBER} for holding 2`)).toBeNull();
  expect(memberOf(view, 3)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  expect(memberOf(view, 4)).toBe('Alex Member');
});

it('says some member choices were reset after a re-read drops one, until the opening is prepared', async () => {
  let answer!: (value: unknown) => void;
  prepareAnswer.mockRejectedValueOnce(movedRefusal()).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const view = await open();
  await map(view);
  await complete(view);
  await submit(view);
  await view.findByText(COPY.HOLDINGS_MOVED);
  holdings = [HOLDINGS[0], HOLDINGS[1]];
  await fireEvent.press(view.getByRole('button', { name: COPY.RELOAD_HOLDINGS }));
  expect(await view.findByText(COPY.CHOICES_RESET)).toBeTruthy();
  await submit(view);
  await waitFor(() => expect(answer).toBeDefined());
  expect(view.queryByText(COPY.CHOICES_RESET)).toBeNull();
  await act(async () => answer({ data: preparedFrom(preparations()[1]) }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(preparations()[1].mapping).toEqual([
    { address: ADA, member: MEMBER_A },
    { address: BEA, member: KEY(1) },
  ]);
});

it('reads the holdings again only on request, not on focus, reconnect or a refresh of the share classes', async () => {
  const view = await open();
  await map(view);
  const holdingsRead = holdingReads().length;
  const appointmentsRead = reads(APPOINTMENTS);
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await act(async () => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await act(async () => void client.invalidateQueries({ queryKey: ['company-tokens'] }));
  await waitFor(() => expect(reads(APPOINTMENTS)).toBeGreaterThan(appointmentsRead));
  expect(holdingReads()).toHaveLength(holdingsRead);
  expect(memberOf(view, 3)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
});

it.each([
  ['another member for an address', { mapping: [{ address: ADA, member: MEMBER_B }] }],
  ['another authority document', { authorityEvidence: 'evidence-other' }],
  ['another share class', { token: 'preference' }],
  ['a staff-era provenance', { providedBy: 'staff_verified' }],
])('stays open and leaves the openings unchanged when the prepared opening names %s', async (_, changes) => {
  prepareAnswer.mockImplementationOnce(async (body: RegisterOpeningPreparation) => ({
    data: { ...preparedFrom(body), ...changes },
  }));
  const view = await open();
  const key = openingsKey(getSessionEpoch(), 'ordinary');
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
  evidenceChanges = [{ kind: 'share_register' }];
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
  const key = openingsKey(epoch, 'ordinary');
  client.setQueryData(key, []);
  await map(view);
  await complete(view);
  await submit(view);
  await waitFor(() => expect(answer).toBeDefined());
  await act(() => invalidateSessionScope());
  await act(async () => answer({ data: preparedFrom(preparations()[0]) }));
  expect(mockGoBack).not.toHaveBeenCalled();
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  expect(view.queryByText(FAILED)).toBeNull();
  await view.findByTestId('prepare-opening-screen');
  expect(holdingReads().map(({ ledovaSessionEpoch }) => ledovaSessionEpoch)).toEqual([epoch, epoch + 1]);
});

it('does not go back when the screen is left while preparing', async () => {
  let answer!: (value: unknown) => void;
  prepareAnswer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const view = await open();
  await map(view);
  await complete(view);
  await submit(view);
  await waitFor(() => expect(answer).toBeDefined());
  await view.unmount();
  await act(async () => answer({ data: preparedFrom(preparations()[0]) }));
  expect(mockGoBack).not.toHaveBeenCalled();
});

it('does not go back when the session changes while the openings are marked to be read again', async () => {
  let settle!: () => void;
  const view = await open();
  const key = openingsKey(getSessionEpoch(), 'ordinary');
  await map(view);
  await complete(view);
  const invalidate = jest.spyOn(client, 'invalidateQueries').mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );
  await submit(view);
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: key }));
  await act(() => invalidateSessionScope());
  await act(async () => settle());
  expect(mockGoBack).not.toHaveBeenCalled();
  await view.findByTestId('prepare-opening-screen');
});

it.each([
  [
    'class',
    () => ({ predicate: ({ queryKey }: { queryKey: readonly unknown[] }) => queryKey.includes('class') }),
    URLS.HOLDERS('ordinary'),
  ],
  ['holdings', () => ({ queryKey: openingHoldersKey(getSessionEpoch(), 'ordinary') }), HOLDINGS_URL],
  ['appointments', () => ({ queryKey: registerAppointmentsKey(getSessionEpoch()) }), APPOINTMENTS],
])('holds preparation while it reads the %s again', async (_, filters, url) => {
  const view = await open();
  await map(view);
  await complete(view);
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeEnabled();
  held = new Set([url]);
  await act(async () => void client.invalidateQueries(filters()));
  await waitFor(() => expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled());
  expect(view.getByTestId('prepare-opening-screen')).toBeTruthy();
  await submit(view);
  expect(uploads()).toEqual([]);
  expect(preparations()).toEqual([]);
});

it('starts a fresh draft for a new session', async () => {
  const view = await open();
  await map(view);
  await complete(view);
  await act(() => invalidateSessionScope());
  await view.findByTestId('prepare-opening-screen');
  expect(view.getByLabelText(COPY.REASON).props.value).toBe('');
  expect(view.getByLabelText(COPY.AUTHORITY_REFERENCE).props.value).toBe('');
  expect(view.getAllByText('Not chosen yet')).toHaveLength(3);
  expect(view.getByRole('button', { name: 'Choose the authority document' })).toBeTruthy();
});

it.each([
  ['class', URLS.HOLDERS('ordinary'), 'Loading the share class…'],
  ['holdings', HOLDINGS_URL, 'Reading the holdings on chain…'],
  ['appointments', APPOINTMENTS, 'Loading the share class…'],
])('shows a new session no form until its own %s read answers', async (_, url, loading) => {
  const view = await open();
  held = new Set([url]);
  await act(() => invalidateSessionScope());
  await waitFor(() => expect(client.isFetching()).toBe(1));
  await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  expect(view.getByText(loading)).toBeTruthy();
  expect(view.queryByTestId('prepare-opening-screen')).toBeNull();
});

it.each([
  ['a register reader', ['read_register']],
  ['an approver', ['approve']],
])('shows %s the read-only note instead of the opening form', async (_, capabilities) => {
  appointments = [appointment('appointment-other', capabilities)];
  const view = await render(<PrepareRegisterOpeningScreen />, { wrapper });
  expect(await view.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(view.queryByText('Holding 1')).toBeNull();
  expect(view.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
});

it('says the chain cannot be read now when the holdings read is unavailable, and maps once a reload succeeds', async () => {
  holdingsAnswer = async () => {
    throw { response: { status: 503, data: { detail: 'A complete canonical register snapshot could not be read.' } } };
  };
  const view = await render(<PrepareRegisterOpeningScreen />, { wrapper });
  expect(await view.findByText(COPY.HOLDERS_UNAVAILABLE)).toBeTruthy();
  expect(view.queryByText(/canonical register snapshot/)).toBeNull();
  expect(reads(APPOINTMENTS)).toBe(1);
  expect(view.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
  holdingsAnswer = null;
  await fireEvent.press(view.getByRole('button', { name: COPY.RELOAD_HOLDINGS }));
  expect(await view.findByTestId('prepare-opening-screen')).toBeTruthy();
  expect(view.getByText('Holding 4')).toBeTruthy();
});

it.each([
  [
    'a refusal in its own words',
    { response: { status: 400, data: ['This share class already has a stored register.'] } },
    'This share class already has a stored register.',
  ],
  ['an unanswered read plainly', new Error('Network Error'), 'The holdings at the boundary could not be read.'],
])('shows a failed holdings read as %s and offers a reload', async (_, failure, message) => {
  holdingsAnswer = async () => {
    throw failure;
  };
  const view = await render(<PrepareRegisterOpeningScreen />, { wrapper });
  expect(await view.findByText(message)).toBeTruthy();
  expect(view.queryByText(COPY.HOLDERS_UNAVAILABLE)).toBeNull();
  expect(view.getByRole('button', { name: COPY.RELOAD_HOLDINGS })).toBeEnabled();
  expect(view.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
});

it('refuses chain holdings whose share counts are not whole, and reads them again on request', async () => {
  holdings = [...HOLDINGS, holding(EVE, '1.5')];
  const view = await render(<PrepareRegisterOpeningScreen />, { wrapper });
  expect(await view.findByText('The holdings at the boundary could not be read.')).toBeTruthy();
  expect(view.queryByText('Holding 1')).toBeNull();
  holdings = HOLDINGS;
  await fireEvent.press(view.getByRole('button', { name: COPY.RELOAD_HOLDINGS }));
  expect(await view.findByTestId('prepare-opening-screen')).toBeTruthy();
  expect(view.queryByText(EVE)).toBeNull();
});

it('keeps the draft but holds the form while a reload of the holdings fails', async () => {
  const view = await open();
  await map(view);
  await complete(view);
  holdingsAnswer = async () => {
    throw { response: { status: 503, data: { detail: 'Unavailable.' } } };
  };
  await act(async () => void client.refetchQueries({ queryKey: openingHoldersKey(getSessionEpoch(), 'ordinary') }));
  expect(await view.findByText(COPY.HOLDERS_UNAVAILABLE)).toBeTruthy();
  expect(view.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
  holdingsAnswer = null;
  await fireEvent.press(view.getByRole('button', { name: COPY.RELOAD_HOLDINGS }));
  await view.findByTestId('prepare-opening-screen');
  expect(view.getByLabelText(COPY.AUTHORITY_REFERENCE).props.value).toBe('RESOLUTION-9');
  expect(memberOf(view, 3)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  await waitFor(() => expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeEnabled());
});

it('offers a retry instead of the form when the class or appointments cannot be read', async () => {
  readsFail = true;
  const view = await render(<PrepareRegisterOpeningScreen />, { wrapper });
  expect(await view.findByText('We couldn’t load this share class and your appointments.')).toBeTruthy();
  expect(view.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
  readsFail = false;
  await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
  expect(await view.findByTestId('prepare-opening-screen')).toBeTruthy();
});

it('drops a holdings read answered after the session changes and reads the holdings again for the new session', async () => {
  let answer!: (value: unknown) => void;
  holdingsAnswer = () =>
    new Promise((resolve) => {
      answer = resolve;
    });
  const view = await render(<PrepareRegisterOpeningScreen />, { wrapper });
  await waitFor(() => expect(answer).toBeDefined());
  const epoch = getSessionEpoch();
  const [retired] = holdingReads();
  holdingsAnswer = null;
  await act(() => invalidateSessionScope());
  expect(retired.signal.aborted).toBe(true);
  await act(async () => answer({ data: { block: BLOCK, holdings: [holding(EVE, '3')] } }));
  await view.findByTestId('prepare-opening-screen');
  expect(view.getByText('Holding 4')).toBeTruthy();
  expect(view.queryByText(EVE)).toBeNull();
  expect(holdingReads().map(({ ledovaSessionEpoch }) => ledovaSessionEpoch)).toEqual([epoch, epoch + 1]);
});

it('prepares once when Prepare is activated twice before the screen updates', async () => {
  let answer!: (value: unknown) => void;
  prepareAnswer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const view = await open();
  await map(view);
  await complete(view);
  const prepare = view.getByRole('button', { name: COPY.SUBMIT });
  await act(() => {
    prepare.props.onClick({ nativeEvent: {} });
    prepare.props.onClick({ nativeEvent: {} });
  });
  await waitFor(() => expect(answer).toBeDefined());
  expect(view.getByRole('button', { name: 'Preparing…' })).toBeDisabled();
  expect(view.queryByRole('alert')).toBeNull();
  await act(async () => answer({ data: preparedFrom(preparations()[0]) }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(uploads()).toHaveLength(1);
  expect(preparations()).toHaveLength(1);
});

it('holds every choice and field while the opening is being prepared', async () => {
  let answer!: (value: unknown) => void;
  prepareAnswer.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const view = await open();
  await map(view);
  await complete(view);
  await submit(view);
  await waitFor(() => expect(answer).toBeDefined());
  for (const name of [
    'Alex Member for holding 2',
    `${COPY.NEW_MEMBER_NUMBERED(1)} for holding 4`,
    `${COPY.NEW_MEMBER} for holding 3`,
  ])
    expect(view.getByLabelText(name)).toBeDisabled();
  expect(view.getByRole('radio', { name: COPY.AUTHORITIES.court_order })).toBeDisabled();
  expect(view.getByRole('button', { name: 'Replace the authority document' })).toBeDisabled();
  expect(view.getByLabelText(COPY.REASON).props.editable).toBe(false);
  await choose(view, 'Alex Member', 2);
  expect(memberOf(view, 2)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  await act(async () => answer({ data: preparedFrom(preparations()[0]) }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
});

it('holds preparation, every choice and the reload offer while the authority document is being chosen', async () => {
  prepareAnswer.mockRejectedValueOnce(movedRefusal());
  const view = await open();
  await map(view);
  await complete(view);
  await submit(view);
  await view.findByText(COPY.HOLDINGS_MOVED);
  expect(view.getByRole('button', { name: COPY.RELOAD_HOLDINGS })).toBeEnabled();
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeEnabled();
  let chosen!: (value: DocumentPicker.DocumentPickerResult) => void;
  pick.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        chosen = resolve;
      }),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Replace the authority document' }));
  await waitFor(() => expect(chosen).toBeDefined());
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  expect(view.getByRole('button', { name: COPY.RELOAD_HOLDINGS })).toBeDisabled();
  expect(view.getByLabelText('Alex Member for holding 2')).toBeDisabled();
  await act(async () => chosen({ canceled: true, assets: null }));
  await waitFor(() => expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeEnabled());
  expect(view.getByRole('button', { name: COPY.RELOAD_HOLDINGS })).toBeEnabled();
});

it('clears the holdings-moved note once the opening is prepared again', async () => {
  let answer!: (value: unknown) => void;
  prepareAnswer.mockRejectedValueOnce(movedRefusal()).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const view = await open();
  await map(view);
  await complete(view);
  await submit(view);
  await view.findByText(COPY.HOLDINGS_MOVED);
  await submit(view);
  await waitFor(() => expect(answer).toBeDefined());
  expect(view.queryByText(COPY.HOLDINGS_MOVED)).toBeNull();
  expect(view.queryByRole('button', { name: COPY.RELOAD_HOLDINGS })).toBeNull();
  await act(async () => answer({ data: preparedFrom(preparations()[1]) }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
});

it('prepares under the prepare appointment when another appointment approves', async () => {
  appointments = [appointment('appointment-approve', ['approve']), appointment('appointment-prepare', ['prepare'])];
  const view = await open();
  await map(view);
  await complete(view);
  await submit(view);
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(field(uploads()[0][1], 'appointment')).toBe('appointment-prepare');
  expect(preparations()).toEqual([expect.objectContaining({ appointment: 'appointment-prepare' })]);
});

it('offers a retry instead of the read-only note when only the appointments cannot be read', async () => {
  failing = new Set([APPOINTMENTS]);
  const view = await render(<PrepareRegisterOpeningScreen />, { wrapper });
  expect(await view.findByText('We couldn’t load this share class and your appointments.')).toBeTruthy();
  expect(view.queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
  failing = new Set();
  await fireEvent.press(view.getByRole('button', { name: 'Retry' }));
  expect(await view.findByTestId('prepare-opening-screen')).toBeTruthy();
});

it('sends no preparation once the screen is left while its upload is pending', async () => {
  let release!: () => void;
  uploadAnswer = (form) =>
    new Promise((resolve) => {
      release = () => resolve({ data: evidenceFor(form) });
    });
  const view = await open();
  const key = openingsKey(getSessionEpoch(), 'ordinary');
  client.setQueryData(key, []);
  await map(view);
  await complete(view);
  await submit(view);
  await waitFor(() => expect(uploads()).toHaveLength(1));
  await view.unmount();
  await act(async () => release());
  expect(preparations()).toEqual([]);
  expect(mockGoBack).not.toHaveBeenCalled();
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
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

it('reads the appointments again after a refused holdings read and withdraws the form once the appointment is gone', async () => {
  let refuse!: (reason: unknown) => void;
  holdingsAnswer = () =>
    new Promise((_, reject) => {
      refuse = reject;
    });
  const view = await render(<PrepareRegisterOpeningScreen />, { wrapper });
  expect(await view.findByText('Reading the holdings on chain…')).toBeTruthy();
  appointments = [];
  await act(async () => refuse({ response: { status: 404, data: { detail: 'Not found.' } } }));
  expect(await view.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(reads(APPOINTMENTS)).toBe(2);
});

it('keeps a refused holdings read in the server’s words while the appointment still prepares', async () => {
  holdingsAnswer = async () => {
    throw { response: { status: 404, data: { detail: 'Not found.' } } };
  };
  const view = await render(<PrepareRegisterOpeningScreen />, { wrapper });
  expect(await view.findByText('Not found.')).toBeTruthy();
  await waitFor(() => expect(reads(APPOINTMENTS)).toBe(2));
  expect(view.getByText('Not found.')).toBeTruthy();
  expect(view.getByRole('button', { name: COPY.RELOAD_HOLDINGS })).toBeEnabled();
});

it('keeps both choices when two holdings are chosen before the screen updates', async () => {
  const view = await open();
  const two = view.getByLabelText(`${COPY.NEW_MEMBER} for holding 2`);
  const three = view.getByLabelText(`${COPY.NEW_MEMBER} for holding 3`);
  await act(() => {
    two.props.onClick({ nativeEvent: {} });
    three.props.onClick({ nativeEvent: {} });
  });
  expect(memberOf(view, 2)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  expect(memberOf(view, 3)).toBe(COPY.NEW_MEMBER_NUMBERED(2));
});

it.each<[string, typeof Platform.OS, string[][]]>([
  ['iOS', 'ios', [[COPY.CHOICES_RESET]]],
  ['Android', 'android', []],
])('announces the reset note once on %s, in a polite live region', async (_, os, announced) => {
  jest.replaceProperty(Platform, 'OS', os);
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  prepareAnswer.mockRejectedValueOnce(movedRefusal());
  const view = await open();
  await map(view);
  await complete(view);
  await submit(view);
  await view.findByText(COPY.HOLDINGS_MOVED);
  holdings = [HOLDINGS[0], HOLDINGS[1]];
  await fireEvent.press(view.getByRole('button', { name: COPY.RELOAD_HOLDINGS }));
  const note = await view.findByText(COPY.CHOICES_RESET);
  expect(note.props.accessibilityLiveRegion).toBe('polite');
  await fireEvent.changeText(view.getByLabelText(COPY.REASON), 'Open the register again');
  expect(view.getByText(COPY.CHOICES_RESET)).toBeTruthy();
  expect(announce.mock.calls).toEqual(announced);
});

it('reads the holdings once for each opening page, so a second page for the class changes nothing on the first', async () => {
  const first = await open();
  await map(first);
  holdings = [HOLDINGS[0], holding(CY, '50')];
  const second = await render(<PrepareRegisterOpeningScreen />, { wrapper });
  await second.findAllByTestId('prepare-opening-screen');
  expect(holdingReads()).toHaveLength(2);
  expect(second.queryByText(BEA)).toBeNull();
  expect(first.getByText(BEA)).toBeTruthy();
  expect(first.queryByText(COPY.CHOICES_RESET)).toBeNull();
  expect(memberOf(first, 2)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  expect(memberOf(first, 3)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  expect(memberOf(first, 4)).toBe('Alex Member');
  await fireEvent.press(second.getByLabelText(`${COPY.NEW_MEMBER} for holding 2`));
  expect(memberOf(second, 2)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  expect(first.getByText('9,007,199,254,740,993 shares')).toBeTruthy();
  expect(memberOf(first, 4)).toBe('Alex Member');
});

it('drops the holdings of an opening page once the page is left', async () => {
  const first = await open();
  const second = await render(<PrepareRegisterOpeningScreen />, { wrapper });
  await second.findAllByTestId('prepare-opening-screen');
  const cached = () => client.getQueryCache().findAll({ queryKey: openingHoldersKey(getSessionEpoch(), 'ordinary') });
  expect(cached()).toHaveLength(2);
  await second.unmount();
  await waitFor(() => expect(cached()).toHaveLength(1));
  await first.unmount();
  await waitFor(() => expect(cached()).toHaveLength(0));
});

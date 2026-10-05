// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  COMPANY_TOKEN_ENDPOINTS,
  REGISTER_CORRECTION_COPY,
  REGISTER_CORRECTION_UNMET_COPY,
  USER_PREFERENCES_QUERY_KEY,
  formatDateTime,
  type AccountRole,
  type CompanyCapability,
  type OwnCompanyAppointment,
  type RegisterCorrection,
  type RegisterCorrectionDecideRequest,
  type RegisterCorrectionDecisionPreview,
  type RegisterDecisionKind,
  type RegisterEntry,
  type TokenHoldersResponse,
} from '@ledova/shared';
import CompanyRegisterPage from '.';
import { companyPreferences, prepareCompanyClient, renderCompanyPage } from '../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

const REGISTER = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const HOLDERS = COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary');
const IMPORTS = COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORTS;
const ENTRIES = COMPANY_TOKEN_ENDPOINTS.REGISTER_ENTRIES('ordinary');
const CORRECTIONS = COMPANY_TOKEN_ENDPOINTS.REGISTER_CORRECTIONS;
const RECONCILIATIONS = COMPANY_TOKEN_ENDPOINTS.REGISTER_RECONCILIATIONS;
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const PREVIEW = COMPANY_TOKEN_ENDPOINTS.REGISTER_CORRECTION_PREVIEW('correction-new');
const DECIDE = COMPANY_TOKEN_ENDPOINTS.REGISTER_CORRECTION_DECIDE('correction-new');
const FILE = COMPANY_TOKEN_ENDPOINTS.REGISTER_CORRECTION_FILE('correction-new');
const ACCOUNT = ['tokens', 'register', 'profile-one', 'account-one'];
const APPOINTMENTS_KEY = ['company-appointments', 'profile-one', 'account-one'];
const DIGEST = 'a'.repeat(64);
const COPY = REGISTER_CORRECTION_COPY;
const KEY = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const NEXT = (path: string, page: number) => `https://example.test${path}?page=${page}`;
const LISTED = { uuid: 'ordinary', companyUuid: 'harbour', companyName: 'Harbour Example Pty Ltd' };
let client: QueryClient;
let appointments: OwnCompanyAppointment[];
let entryPages: Paged<RegisterEntry>[];
let correctionPages: Paged<RegisterCorrection>[];
let previewFor: (body: { kind: RegisterDecisionKind; reason: string }) => RegisterCorrectionDecisionPreview;
let decideFor: (body: RegisterCorrectionDecideRequest) => Promise<{ data: RegisterCorrection }>;

type Paged<T> = { data: { results: T[]; count: number; next: string | null; previous: null } };

function entry(overrides: Partial<RegisterEntry> = {}): RegisterEntry {
  return {
    uuid: 'entry-issue',
    sequence: 2,
    kind: 'issue',
    effectiveOn: '2026-09-02',
    recordedAt: '2026-09-02T01:00:00Z',
    changes: [{ member: 'member-two', name: 'Second Member', shares: '250' }],
    corrects: null,
    correctedBy: null,
    correctable: true,
    ...overrides,
  };
}

const OPENING = entry({
  uuid: 'entry-opening',
  sequence: 1,
  kind: 'opening',
  effectiveOn: '2026-09-01',
  recordedAt: '2026-09-01T01:00:00Z',
  changes: [
    { member: 'member-one', name: 'Example Member', shares: '9007199254740993' },
    { member: 'member-three', name: null, shares: '5' },
  ],
});
const ISSUE = entry();
const TRANSFER = entry({
  uuid: 'entry-transfer',
  sequence: 3,
  kind: 'transfer',
  effectiveOn: '2026-09-03',
  recordedAt: '2026-09-03T01:00:00Z',
  changes: [
    { member: 'member-one', name: 'Example Member', shares: '-100' },
    { member: 'member-two', name: 'Second Member', shares: '100' },
  ],
  correctedBy: 'entry-reversal',
  correctable: false,
});
const REVERSAL = entry({
  uuid: 'entry-reversal',
  sequence: 4,
  kind: 'correction',
  effectiveOn: '2026-09-04',
  recordedAt: '2026-09-04T01:00:00Z',
  changes: [
    { member: 'member-one', name: 'Example Member', shares: '100' },
    { member: 'member-two', name: 'Second Member', shares: '-100' },
  ],
  corrects: 'entry-transfer',
});

function holders(): TokenHoldersResponse {
  return {
    token: {
      uuid: 'ordinary',
      name: 'Ordinary shares',
      symbol: 'ORD',
      status: 'deployed',
      totalSupply: '9007199254741999',
    },
    initialized: true,
    issuedSupply: '9007199254741248',
    waitingEffects: 0,
    holders: [],
    totalHolders: 0,
    formerMembers: [],
    formerMembersAsAt: null,
    formerMembersBlock: null,
    formerMembersStale: false,
  };
}

function appointment(
  capabilities: CompanyCapability[],
  overrides: Partial<OwnCompanyAppointment> = {},
): OwnCompanyAppointment {
  return {
    uuid: 'appointment-a',
    company: 'harbour',
    companyName: 'Harbour Example Pty Ltd',
    source: 'invitation',
    status: 'active',
    isEffective: true,
    capabilities,
    delegatableCapabilities: [],
    createdAt: '2026-10-01T00:00:00Z',
    expiresAt: null,
    revokedAt: null,
    declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION,
    declarationText: COMPANY_AUTHORITY_DECLARATION,
    ...overrides,
  };
}

function correction(overrides: Partial<RegisterCorrection> = {}): RegisterCorrection {
  return {
    uuid: 'correction-new',
    company: 'harbour',
    register: 'register-ordinary',
    corrects: 'entry-issue',
    baseSequence: 4,
    baseHash: 'b'.repeat(64),
    effectiveOn: '2026-10-01',
    changes: [{ member: 'member-two', shares: '-250' }],
    authority: 'director_resolution',
    approvingDirector: 'Example Director',
    authorityReference: 'RESOLUTION-CORRECTION-1',
    reason: 'Reverse the duplicated issue',
    sourceDocument: null,
    evidenceFingerprint: 'c'.repeat(64),
    evidenceSnapshot: { providedBy: 'company', name: 'signed-resolution.pdf', mimeType: 'application/pdf' },
    authorityEvidence: 'evidence-authority',
    preparingAppointment: 'appointment-a',
    preparedByName: 'Example Preparer',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    appliedEntry: null,
    decisions: [],
    createdAt: '2026-10-05T01:00:00Z',
    ...overrides,
  };
}

function staffEra(overrides: Partial<RegisterCorrection> = {}) {
  return correction({
    uuid: 'correction-staff',
    corrects: 'entry-opening',
    changes: [
      { member: 'member-one', shares: '-9007199254740993' },
      { member: 'member-three', shares: '-5' },
    ],
    providedBy: 'staff_verified',
    preparedByName: null,
    preparingAppointment: null,
    authorityEvidence: null,
    sourceDocument: 'document-staff',
    evidenceSnapshot: {},
    createdAt: '2026-09-30T01:00:00Z',
    ...overrides,
  });
}

function preview(overrides: Partial<RegisterCorrectionDecisionPreview> = {}): RegisterCorrectionDecisionPreview {
  return {
    previewDigest: DIGEST,
    unmetRequirements: [],
    canDecide: true,
    registerSequence: 4,
    effectiveOn: '2026-10-01',
    originalChanges: [{ member: 'member-two', shares: '250' }],
    changes: [{ member: 'member-two', shares: '-250' }],
    ...overrides,
  };
}

function decided(request: RegisterCorrectionDecideRequest, base = correction()): RegisterCorrection {
  const decision = {
    uuid: `decision-${request.idempotencyKey}`,
    kind: request.kind,
    decidedBy: 1,
    decidedByName: 'Example Decider',
    appointment: request.appointment,
    idempotencyKey: request.idempotencyKey,
    digest: request.previewDigest,
    reason: request.reason ?? '',
    decidedAt: '2026-10-05T02:00:00Z',
  };
  const effect =
    request.kind === 'apply'
      ? { status: 'applied' as const, stage: 'applied', reviewedAt: decision.decidedAt, appliedEntry: 'entry-applied' }
      : request.kind === 'reject'
        ? {
            status: 'rejected' as const,
            stage: 'rejected',
            reviewedAt: decision.decidedAt,
            rejectionReason: decision.reason,
          }
        : { stage: 'approved' };
  return { ...base, ...effect, decisions: [...base.decisions, decision] };
}

function page<T>(results: T[], next: string | null = null): Paged<T> {
  return { data: { results, count: results.length, next, previous: null } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function reads(url: string) {
  return api.get.mock.calls.filter(([called]) => called === url).length;
}

function writes(url: string) {
  return api.post.mock.calls.filter(([called]) => called === url);
}

function serve(read?: (url: string, config?: { params?: { page?: number } }) => unknown) {
  api.get.mockImplementation(async (url: string, config?: { params?: { page?: number } }) => {
    const answer = read?.(url, config);
    if (answer !== undefined) return answer;
    const at = (config?.params?.page ?? 1) - 1;
    if (url === REGISTER) return page([LISTED]);
    if (url === HOLDERS) return { data: holders() };
    if (url === APPOINTMENTS) return page(appointments);
    if (url === IMPORTS || url === RECONCILIATIONS) return page([]);
    if (url === ENTRIES) return entryPages[at];
    if (url === CORRECTIONS) return correctionPages[at];
    if (url.endsWith('/file/')) return { data: new Blob(['%PDF synthetic'], { type: 'application/pdf' }) };
    throw new Error(`Unexpected read ${url} ${JSON.stringify(config)}`);
  });
}

function switchAccount() {
  const other = companyPreferences('company');
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { ...other, userProfile: 'profile-two', userAccount: { ...other.userAccount!, uuid: 'account-two' } },
  });
}

async function openClass(role: AccountRole = 'company') {
  prepareCompanyClient(client, role);
  client.setQueryData(['userAccount'], { data: { role } });
  renderCompanyPage(client, <CompanyRegisterPage />, 'Register');
  fireEvent.click(await screen.findByRole('button', { name: /Ordinary shares/ }));
}

async function section(title: string) {
  const heading = await screen.findByRole('heading', { level: 3, name: title });
  const element = heading.parentElement!;
  await waitFor(() => expect(within(element).queryByRole('status')).toBeNull());
  return element;
}

async function history() {
  return section(COPY.ENTRIES_TITLE);
}

async function corrections() {
  return section(COPY.TITLE);
}

function records(element: HTMLElement) {
  return within(element).getAllByRole('listitem');
}

function rows(element: HTMLElement) {
  return within(element)
    .getAllByRole('term')
    .map((term) => [term.textContent, [...term.nextElementSibling!.children].map((line) => line.textContent)]);
}

function rowText(element: HTMLElement, label: string) {
  return within(element).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
}

function decisionLabels(record: HTMLElement) {
  return within(record)
    .queryAllByRole('button')
    .map((button) => button.textContent)
    .filter((label) => ['Approve', 'Apply', 'Reject'].includes(label ?? ''));
}

async function openDecision(record: HTMLElement, kind: RegisterDecisionKind) {
  fireEvent.click(within(record).getByRole('button', { name: COPY.DECISIONS[kind] }));
  return screen.findByRole('dialog', { name: `${COPY.DECISIONS[kind]} correction` });
}

function confirmButton(dialog: HTMLElement, kind: RegisterDecisionKind) {
  return within(dialog).getByRole('button', { name: `${COPY.DECISIONS[kind]} correction` }) as HTMLButtonElement;
}

async function previewed(dialog: HTMLElement) {
  await within(dialog).findByText('Register sequence');
}

function stubDownloads() {
  const saved: string[] = [];
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:synthetic');
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push(this.download);
  });
  return saved;
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let keys = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => KEY(++keys) as ReturnType<typeof crypto.randomUUID>);
  appointments = [appointment(['admin'])];
  entryPages = [page([REVERSAL, TRANSFER], NEXT(ENTRIES, 2)), page([ISSUE, OPENING])];
  correctionPages = [page([correction()])];
  previewFor = () => preview();
  decideFor = async (body) => ({ data: decided(body) });
  serve();
  api.post.mockImplementation(async (url: string, body: RegisterCorrectionDecideRequest) => {
    if (url === PREVIEW) return { data: previewFor(body as { kind: RegisterDecisionKind; reason: string }) };
    if (url === DECIDE) return decideFor(body);
    throw new Error(`Unexpected write ${url}`);
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('lists the class register newest first a page at a time, naming each change and linking corrections both ways', async () => {
  correctionPages = [page([])];
  await openClass();
  const register = await history();
  expect(api.get).toHaveBeenCalledWith(ENTRIES, { params: { page: 1 }, ledovaSubmissionGuard: expect.any(Function) });
  const [reversal, transfer] = records(register);
  expect(records(register)).toHaveLength(2);
  expect(within(reversal).getByText(COPY.ENTRY_KINDS.correction)).toBeTruthy();
  expect(within(reversal).getByText('Entry 4')).toBeTruthy();
  expect(
    within(reversal).getByText(`Effective 2026-09-04 · Recorded ${formatDateTime('2026-09-04T01:00:00Z')}`),
  ).toBeTruthy();
  expect(within(reversal).getByText('Example Member: +100')).toBeTruthy();
  expect(within(reversal).getByText('Second Member: -100')).toBeTruthy();
  expect(within(reversal).getByText('Corrects entry 3.')).toBeTruthy();
  expect(within(transfer).getByText(COPY.ENTRY_KINDS.transfer)).toBeTruthy();
  expect(within(transfer).getByText('Example Member: -100')).toBeTruthy();
  expect(within(transfer).getByText('Reversed by entry 4.')).toBeTruthy();
  expect(within(transfer).queryByText(/^Corrects/)).toBeNull();
  expect(within(reversal).queryByText(/^Reversed by/)).toBeNull();
  expect(reads(ENTRIES)).toBe(1);

  fireEvent.click(within(register).getByRole('button', { name: 'Load more register entries' }));
  await waitFor(() => expect(records(register)).toHaveLength(4));
  expect(api.get).toHaveBeenCalledWith(ENTRIES, { params: { page: 2 }, ledovaSubmissionGuard: expect.any(Function) });
  const [, , issue, opening] = records(register);
  expect(within(issue).getByText('Second Member: +250')).toBeTruthy();
  expect(within(opening).getByText(COPY.ENTRY_KINDS.opening)).toBeTruthy();
  expect(within(opening).getByText('Example Member: +9,007,199,254,740,993')).toBeTruthy();
  expect(within(opening).getByText(`${COPY.UNNAMED_MEMBER('member-three')}: +5`)).toBeTruthy();
  expect(within(register).queryByRole('button', { name: /Load more/ })).toBeNull();
  expect(reads(ENTRIES)).toBe(2);
});

it("names the entry a correction reverses from the class's corrections before its page is loaded", async () => {
  const earlier = entry({ uuid: 'entry-early', sequence: 1, correctedBy: 'entry-late', correctable: false });
  const later = entry({ uuid: 'entry-late', sequence: 30, kind: 'correction', corrects: 'entry-early' });
  entryPages = [page([later], NEXT(ENTRIES, 2)), page([earlier])];
  correctionPages = [page([correction({ corrects: 'entry-early', appliedEntry: 'entry-late', status: 'applied' })])];
  await openClass();
  await corrections();
  const register = await history();
  expect(within(records(register)[0]).getByText('Corrects entry 1.')).toBeTruthy();
});

it('says an entry was corrected, or corrects another, without a number until that entry is known', async () => {
  entryPages = [
    page([
      entry({ uuid: 'entry-late', sequence: 30, kind: 'correction', corrects: 'entry-unknown' }),
      entry({ uuid: 'entry-early', sequence: 29, correctedBy: 'entry-missing', correctable: false }),
    ]),
  ];
  correctionPages = [page([])];
  await openClass();
  const [late, early] = records(await history());
  expect(within(late).getByText('Corrects an earlier entry.')).toBeTruthy();
  expect(within(early).getByText(COPY.CORRECTED_NOTE)).toBeTruthy();
});

it('refuses entry pages whose next link does not advance', async () => {
  entryPages = [page([REVERSAL, TRANSFER], NEXT(ENTRIES, 1))];
  correctionPages = [page([])];
  await openClass();
  const register = await history();
  expect(within(register).getByRole('alert').textContent).toContain(
    "We couldn't load the register entries for this share class.",
  );
  expect(within(register).queryByRole('listitem')).toBeNull();
});

it('hides stale entries after a failed refresh', async () => {
  correctionPages = [page([])];
  await openClass();
  const register = await history();
  expect(records(register)).toHaveLength(2);
  serve((url) => (url === ENTRIES ? Promise.reject(new Error('Unavailable')) : undefined));
  await act(async () => {
    await client.refetchQueries({ queryKey: [...ACCOUNT, 'entries', 'ordinary'] });
  });
  await waitFor(() => expect(within(register).queryByRole('listitem')).toBeNull());
  expect(within(register).getByRole('alert')).toBeTruthy();
});

it('says calmly that the register of a class has no entries yet', async () => {
  entryPages = [page([])];
  correctionPages = [page([])];
  await openClass();
  expect(within(await history()).getByText(COPY.ENTRIES_EMPTY)).toBeTruthy();
  expect(within(await corrections()).getByText(COPY.EMPTY)).toBeTruthy();
});

it('hides the entries when their first page fails and shows them after a retry', async () => {
  let fail = true;
  correctionPages = [page([])];
  serve((url) => (url === ENTRIES && fail ? Promise.reject(new Error('Unavailable')) : undefined));
  await openClass();
  const register = await history();
  expect(within(register).getByRole('alert').textContent).toContain(
    "We couldn't load the register entries for this share class.",
  );
  expect(within(register).queryByRole('listitem')).toBeNull();
  fail = false;
  fireEvent.click(within(register).getByRole('button', { name: 'Retry register entries' }));
  await waitFor(() => expect(records(register)).toHaveLength(2));
  expect(within(register).queryByRole('alert')).toBeNull();
});

it('keeps the loaded entries and offers another try when a later page fails', async () => {
  let fail = true;
  correctionPages = [page([])];
  serve((url, config) =>
    url === ENTRIES && config?.params?.page === 2 && fail ? Promise.reject(new Error('Unavailable')) : undefined,
  );
  await openClass();
  const register = await history();
  fireEvent.click(within(register).getByRole('button', { name: 'Load more register entries' }));
  expect((await within(register).findByRole('alert')).textContent).toContain(
    'More register entries could not be loaded. The list is incomplete.',
  );
  expect(records(register)).toHaveLength(2);
  fail = false;
  fireEvent.click(within(register).getByRole('button', { name: 'Try more register entries again' }));
  await waitFor(() => expect(records(register)).toHaveLength(4));
  expect(within(register).queryByRole('alert')).toBeNull();
});

it.each([
  ['admin', true],
  ['prepare', true],
  ['approve', false],
  ['apply', false],
  ['read_register', false],
] as const)('offers an appointment holding %s a correction of each correctable entry: %s', async (held, offered) => {
  appointments = [appointment([held])];
  correctionPages = [page([])];
  await openClass();
  const register = await history();
  fireEvent.click(within(register).getByRole('button', { name: 'Load more register entries' }));
  await waitFor(() => expect(records(register)).toHaveLength(4));
  expect(
    within(register)
      .queryAllByRole('link', { name: COPY.PREPARE })
      .map((link) => link.getAttribute('href')),
  ).toEqual(
    offered
      ? [
          '/company/register/ordinary/correct/entry-reversal',
          '/company/register/ordinary/correct/entry-issue',
          '/company/register/ordinary/correct/entry-opening',
        ]
      : [],
  );
});

it("lists every page of the class's corrections, newest first, each with the entry it corrects and its particulars", async () => {
  const approval = {
    uuid: 'decision-approve',
    kind: 'approve' as const,
    decidedBy: 2,
    decidedByName: 'Example Approver',
    appointment: 'appointment-b',
    idempotencyKey: KEY(90),
    digest: DIGEST,
    reason: '',
    decidedAt: '2026-10-02T03:00:00Z',
  };
  const application = {
    ...approval,
    uuid: 'decision-apply',
    kind: 'apply' as const,
    decidedAt: '2026-10-02T04:00:00Z',
  };
  const applied = correction({
    uuid: 'correction-applied',
    corrects: 'entry-transfer',
    appliedEntry: 'entry-reversal',
    changes: [
      { member: 'member-one', shares: '100' },
      { member: 'member-two', shares: '-100' },
    ],
    authority: 'court_order',
    approvingDirector: '',
    authorityReference: 'COURT-ORDER-7',
    reason: 'Reverse the transfer the court set aside',
    status: 'applied',
    stage: 'applied',
    reviewedAt: application.decidedAt,
    decisions: [application, approval],
    createdAt: '2026-10-02T01:00:00Z',
  });
  const retired = staffEra({
    uuid: 'correction-retired',
    status: 'rejected',
    stage: 'rejected',
    rejectionReason: 'Superseded by the company-run correction',
    reviewedAt: '2026-09-30T05:00:00Z',
  });
  correctionPages = [page([retired], NEXT(CORRECTIONS, 2)), page([applied, correction()])];
  await openClass();
  const list = await corrections();
  expect(api.get).toHaveBeenCalledWith(CORRECTIONS, {
    params: { token: 'ordinary', page: 1 },
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(api.get).toHaveBeenCalledWith(CORRECTIONS, {
    params: { token: 'ordinary', page: 2 },
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(api.get).toHaveBeenCalledWith(ENTRIES, { params: { page: 2 }, ledovaSubmissionGuard: expect.any(Function) });
  const [newest, middle, oldest] = records(list);
  expect(records(list)).toHaveLength(3);
  expect(rows(newest)).toEqual([
    ['Stage', [COPY.STAGES.submitted]],
    ['Prepared by', []],
    ['Prepared on', []],
    [COPY.EFFECTIVE_ON, []],
    [COPY.ORIGINAL_CHANGES, ['Issue · Entry 2 · Effective 2026-09-02', 'Second Member: +250']],
    [COPY.COMPENSATING_CHANGES, ['Second Member: -250']],
    [COPY.AUTHORITY, []],
    [COPY.APPROVING_DIRECTOR, []],
    [COPY.AUTHORITY_REFERENCE, []],
    [COPY.REASON, []],
  ]);
  expect(rowText(newest, 'Prepared by')).toBe('Example Preparer');
  expect(rowText(newest, 'Prepared on')).toBe(formatDateTime('2026-10-05T01:00:00Z'));
  expect(rowText(newest, COPY.EFFECTIVE_ON)).toBe('2026-10-01');
  expect(rowText(newest, COPY.AUTHORITY)).toBe(COPY.AUTHORITIES.director_resolution);
  expect(rowText(newest, COPY.APPROVING_DIRECTOR)).toBe('Example Director');
  expect(rowText(newest, COPY.AUTHORITY_REFERENCE)).toBe('RESOLUTION-CORRECTION-1');
  expect(rowText(newest, COPY.REASON)).toBe('Reverse the duplicated issue');
  expect(within(newest).getByText(COPY.PROVIDED_BY_COMPANY)).toBeTruthy();

  expect(within(middle).getByText(COPY.STAGES.applied)).toBeTruthy();
  expect(rowText(middle, COPY.AUTHORITY)).toBe(COPY.AUTHORITIES.court_order);
  expect(within(middle).queryByText(COPY.APPROVING_DIRECTOR)).toBeNull();
  expect(rowText(middle, COPY.COMPENSATING_CHANGES)).toBe('Example Member: +100Second Member: -100');
  const trail = rows(middle).map(([label]) => label);
  expect(trail.indexOf('Approve')).toBeLessThan(trail.indexOf('Apply'));
  expect(rowText(middle, 'Approve')).toBe(`Example Approver · ${formatDateTime(approval.decidedAt)}`);
  expect(rowText(middle, 'Apply')).toBe(`Example Approver · ${formatDateTime(application.decidedAt)}`);
  expect(within(middle).queryByText('Decided on')).toBeNull();

  expect(within(oldest).getByText(COPY.STAFF_VERIFIED)).toBeTruthy();
  expect(within(oldest).queryByText(COPY.PROVIDED_BY_COMPANY)).toBeNull();
  expect(within(oldest).queryByText('Prepared by')).toBeNull();
  expect(rowText(oldest, 'Rejection reason')).toBe('Superseded by the company-run correction');
  expect(rowText(oldest, 'Decided on')).toBe(formatDateTime('2026-09-30T05:00:00Z'));
  expect(rowText(oldest, COPY.ORIGINAL_CHANGES)).toBe(
    `Opening state · Entry 1 · Effective 2026-09-01Example Member: +9,007,199,254,740,993${COPY.UNNAMED_MEMBER('member-three')}: +5`,
  );
  for (const record of [newest, middle, oldest])
    expect(within(record).getByRole('button', { name: COPY.DOWNLOAD })).toBeTruthy();
  expect(
    client
      .getQueryData<unknown[]>([...ACCOUNT, 'corrections', 'ordinary'])
      ?.map((item) => (item as { proposal: RegisterCorrection }).proposal.uuid),
  ).toEqual(['correction-new', 'correction-applied', 'correction-retired']);
});

it('reads no further entries for a class without corrections, and says so calmly', async () => {
  correctionPages = [page([])];
  await openClass();
  expect(within(await corrections()).getByText(COPY.EMPTY)).toBeTruthy();
  await history();
  expect(reads(ENTRIES)).toBe(1);
});

it.each([
  ['the newest page', correction({ corrects: 'entry-reversal' }), [1]],
  ['a later page', correction(), [1, 2]],
] as const)(
  "reads the class's register only until it finds an entry a correction reverses on %s",
  async (_where, corrected, pages) => {
    correctionPages = [page([corrected])];
    entryPages = [...entryPages, page([])];
    entryPages[1] = page([ISSUE, OPENING], NEXT(ENTRIES, 3));
    await openClass();
    expect(records(await corrections())).toHaveLength(1);
    await history();
    expect(api.get.mock.calls.filter(([url]) => url === ENTRIES).map(([, config]) => config.params.page)).toEqual([
      1,
      ...pages,
    ]);
  },
);

it("refuses corrections naming an entry outside the class's register, and offers a retry", async () => {
  correctionPages = [page([correction({ corrects: 'entry-elsewhere' })])];
  await openClass();
  const list = await corrections();
  expect(within(list).getByRole('alert').textContent).toContain(
    "We couldn't load the corrections for this share class.",
  );
  expect(within(list).queryByRole('listitem')).toBeNull();
  correctionPages = [page([correction()])];
  fireEvent.click(within(list).getByRole('button', { name: 'Retry corrections' }));
  await waitFor(() => expect(records(list)).toHaveLength(1));
});

it.each([
  ['an investor-role register reader', 'investor', [appointment(['read_register'])]],
  ['an owner without an appointment', 'company', []],
  ['an administrator of another company', 'company', [appointment(['admin'], { company: 'inland' })]],
  ['an administrator whose appointment is not effective', 'company', [appointment(['admin'], { isEffective: false })]],
  [
    'an administrator whose appointment has passed its expiry',
    'company',
    [appointment(['admin'], { expiresAt: '2020-01-01T00:00:00Z' })],
  ],
  [
    'an administrator whose appointment was revoked',
    'company',
    [appointment(['admin'], { status: 'revoked', revokedAt: '2026-10-04T00:00:00Z' })],
  ],
] as const)('shows %s the history and corrections with the read-only note and no steps', async (_who, role, held) => {
  appointments = [...held];
  await openClass(role);
  const list = await corrections();
  const register = await history();
  expect(within(list).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(within(list).getByText('Example Preparer')).toBeTruthy();
  expect(decisionLabels(records(list)[0])).toEqual([]);
  expect(within(register).queryByRole('link', { name: COPY.PREPARE })).toBeNull();
  expect(records(register)).toHaveLength(2);
  expect(within(list).getByRole('button', { name: COPY.DOWNLOAD })).toBeTruthy();
});

it.each([
  ['admin', ['Approve', 'Apply', 'Reject']],
  ['prepare', []],
  ['approve', ['Approve', 'Reject']],
  ['apply', ['Apply']],
] as const)('offers an appointment holding %s exactly its correction steps', async (held, steps) => {
  appointments = [appointment([held])];
  await openClass();
  const list = await corrections();
  expect(decisionLabels(records(list)[0])).toEqual(steps);
  expect(within(list).queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
});

it('offers a retained staff-era correction only rejection', async () => {
  correctionPages = [page([staffEra()])];
  await openClass();
  const list = await corrections();
  expect(decisionLabels(records(list)[0])).toEqual(['Reject']);
  expect(within(list).getByText(COPY.STAFF_VERIFIED)).toBeTruthy();
});

it.each(['applied', 'rejected'] as const)('offers no step on a correction already %s', async (status) => {
  correctionPages = [page([correction({ status, stage: status })])];
  await openClass();
  const list = await corrections();
  expect(decisionLabels(records(list)[0])).toEqual([]);
});

it('previews an approval, then records exactly the previewed decision and refreshes what it changes', async () => {
  await openClass();
  const list = await corrections();
  await history();
  const dialog = await openDecision(records(list)[0], 'approve');
  await previewed(dialog);
  expect(writes(PREVIEW)).toEqual([
    [
      PREVIEW,
      { appointment: 'appointment-a', kind: 'approve', reason: '' },
      { ledovaSubmissionGuard: expect.any(Function) },
    ],
  ]);
  expect(within(dialog).getByText(COPY.CONFIRMATIONS.approve)).toBeTruthy();
  expect(rows(dialog)).toEqual([
    ['Register sequence', []],
    [COPY.EFFECTIVE_ON, []],
    [COPY.ORIGINAL_CHANGES, ['Second Member: +250']],
    [COPY.COMPENSATING_CHANGES, ['Second Member: -250']],
  ]);
  expect(rowText(dialog, 'Register sequence')).toBe('4');
  expect(rowText(dialog, COPY.EFFECTIVE_ON)).toBe('2026-10-01');
  expect(within(dialog).queryByText(COPY.COMPENSATION_NOTE)).toBeNull();
  const before = [reads(CORRECTIONS), reads(ENTRIES), reads(HOLDERS), reads(APPOINTMENTS)];
  correctionPages = [
    page([
      decided({
        appointment: 'appointment-a',
        kind: 'approve',
        reason: '',
        idempotencyKey: KEY(1),
        previewDigest: DIGEST,
        confirmation: true,
      }),
    ]),
  ];
  fireEvent.click(confirmButton(dialog, 'approve'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(writes(DECIDE)).toEqual([
    [
      DECIDE,
      {
        appointment: 'appointment-a',
        kind: 'approve',
        reason: '',
        idempotencyKey: KEY(1),
        previewDigest: DIGEST,
        confirmation: true,
      },
      { ledovaSubmissionGuard: expect.any(Function) },
    ],
  ]);
  await waitFor(() =>
    expect([reads(CORRECTIONS), reads(ENTRIES), reads(HOLDERS), reads(APPOINTMENTS)]).toEqual([
      before[0] + 1,
      before[1] + 3,
      before[2] + 1,
      before[3] + 1,
    ]),
  );
  expect(await within(list).findByText(COPY.STAGES.approved)).toBeTruthy();
  expect(rowText(list, 'Approve')).toBe(`Example Decider · ${formatDateTime('2026-10-05T02:00:00Z')}`);
});

it.each([
  ['apply', true],
  ['approve', false],
  ['reject', false],
] as const)('shows the compensation note when previewing %s: %s', async (kind, shown) => {
  await openClass();
  const dialog = await openDecision(records(await corrections())[0], kind);
  await previewed(dialog);
  expect(!!within(dialog).queryByText(COPY.COMPENSATION_NOTE)).toBe(shown);
});

it('previews and records each step under the appointment that holds it', async () => {
  appointments = [
    appointment(['approve'], { uuid: 'appointment-b' }),
    appointment(['apply'], { uuid: 'appointment-c' }),
  ];
  await openClass();
  const [record] = records(await corrections());
  let dialog = await openDecision(record, 'apply');
  await previewed(dialog);
  fireEvent.click(confirmButton(dialog, 'apply'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  dialog = await openDecision(records(await corrections())[0], 'reject');
  await previewed(dialog);
  expect(writes(PREVIEW).map(([, body]) => body.appointment)).toEqual(['appointment-c', 'appointment-b']);
  expect(writes(DECIDE).map(([, body]) => body.appointment)).toEqual(['appointment-c']);
});

it('starts a reopened rejection with a blank reason', async () => {
  await openClass();
  const [record] = records(await corrections());
  let dialog = await openDecision(record, 'reject');
  await previewed(dialog);
  fireEvent.change(within(dialog).getByLabelText(COPY.REJECTION_REASON), { target: { value: 'Draft reason' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  dialog = await openDecision(record, 'reject');
  expect((within(dialog).getByLabelText(COPY.REJECTION_REASON) as HTMLTextAreaElement).value).toBe('');
});

it('lists unmet requirements in words and keeps the decision unconfirmable while any remain', async () => {
  previewFor = () =>
    preview({ canDecide: false, unmetRequirements: ['approval_lapsed', 'register_changed', 'future_rule'] });
  await openClass();
  const dialog = await openDecision(records(await corrections())[0], 'apply');
  expect(await within(dialog).findByText(REGISTER_CORRECTION_UNMET_COPY.approval_lapsed)).toBeTruthy();
  expect(within(dialog).getByText(REGISTER_CORRECTION_UNMET_COPY.register_changed)).toBeTruthy();
  expect(within(dialog).getByText('future_rule')).toBeTruthy();
  const confirm = confirmButton(dialog, 'apply');
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(writes(DECIDE)).toHaveLength(0);
});

it.each([
  [
    'revoked',
    () => {
      appointments = [
        appointment(['admin'], { status: 'revoked', isEffective: false, revokedAt: '2026-10-05T03:00:00Z' }),
      ];
    },
  ],
  [
    'replaced by another appointment',
    () => {
      appointments = [appointment(['admin'], { uuid: 'appointment-0' })];
    },
  ],
  [
    'unreadable',
    () => {
      serve((url) => (url === APPOINTMENTS ? Promise.reject(new Error('Unavailable')) : undefined));
    },
  ],
] as const)('holds a previewed decision once its step appointment is %s', async (_change, change) => {
  await openClass();
  const dialog = await openDecision(records(await corrections())[0], 'approve');
  await previewed(dialog);
  expect(confirmButton(dialog, 'approve').disabled).toBe(false);
  change();
  await act(async () => {
    await client.refetchQueries({ queryKey: APPOINTMENTS_KEY });
  });
  await waitFor(() => expect(confirmButton(dialog, 'approve').disabled).toBe(true));
  expect(within(dialog).getByText(/Your appointment for this step changed or could not be checked/)).toBeTruthy();
  fireEvent.click(confirmButton(dialog, 'approve'));
  expect(writes(DECIDE)).toHaveLength(0);
});

it('withdraws every step and correction link once a refresh shows the appointment revoked', async () => {
  await openClass();
  const list = await corrections();
  const register = await history();
  expect(decisionLabels(records(list)[0])).toEqual(['Approve', 'Apply', 'Reject']);
  expect(within(register).getAllByRole('link', { name: COPY.PREPARE })).toHaveLength(1);
  appointments = [appointment(['admin'], { status: 'revoked', isEffective: false, revokedAt: '2026-10-05T03:00:00Z' })];
  await act(async () => {
    await client.refetchQueries({ queryKey: APPOINTMENTS_KEY });
  });
  await waitFor(() => expect(decisionLabels(records(list)[0])).toEqual([]));
  expect(within(register).queryByRole('link', { name: COPY.PREPARE })).toBeNull();
  expect(within(list).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('withholds every step while the appointments cannot be read, and offers their retry', async () => {
  let fail = true;
  serve((url) => (url === APPOINTMENTS && fail ? Promise.reject(new Error('Unavailable')) : undefined));
  await openClass();
  const list = await corrections();
  const register = await history();
  await waitFor(() =>
    expect(within(list).getByRole('alert').textContent).toContain(
      'Your appointments could not be loaded. Retry before preparing or deciding a correction.',
    ),
  );
  expect(decisionLabels(records(list)[0])).toEqual([]);
  expect(within(register).queryByRole('link', { name: COPY.PREPARE })).toBeNull();
  expect(within(list).queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
  fail = false;
  fireEvent.click(within(list).getByRole('button', { name: 'Retry appointments' }));
  await waitFor(() => expect(decisionLabels(records(list)[0])).toEqual(['Approve', 'Apply', 'Reject']));
});

it('previews a rejection again with its reason and records exactly that reason', async () => {
  previewFor = ({ reason }) =>
    reason
      ? preview({ previewDigest: 'd'.repeat(64) })
      : preview({ canDecide: false, unmetRequirements: ['reason_required'] });
  await openClass();
  const dialog = await openDecision(records(await corrections())[0], 'reject');
  expect(await within(dialog).findByText(REGISTER_CORRECTION_UNMET_COPY.reason_required)).toBeTruthy();
  expect(within(dialog).getByText(COPY.CONFIRMATIONS.reject)).toBeTruthy();
  const reason = within(dialog).getByLabelText(COPY.REJECTION_REASON) as HTMLTextAreaElement;
  expect(reason.maxLength).toBe(1000);
  const again = within(dialog).getByRole('button', { name: 'Preview the rejection' }) as HTMLButtonElement;
  expect(confirmButton(dialog, 'reject').disabled).toBe(true);
  expect(again.disabled).toBe(true);
  fireEvent.change(reason, { target: { value: '  Prepared against the wrong entry  ' } });
  fireEvent.click(again);
  await waitFor(() => expect(confirmButton(dialog, 'reject').disabled).toBe(false));
  expect(again.disabled).toBe(true);
  expect(writes(PREVIEW).map(([, body]) => body)).toEqual([
    { appointment: 'appointment-a', kind: 'reject', reason: '' },
    { appointment: 'appointment-a', kind: 'reject', reason: 'Prepared against the wrong entry' },
  ]);
  fireEvent.change(reason, { target: { value: 'Another reason' } });
  expect(confirmButton(dialog, 'reject').disabled).toBe(true);
  fireEvent.click(confirmButton(dialog, 'reject'));
  expect(writes(DECIDE)).toHaveLength(0);
  fireEvent.change(reason, { target: { value: 'Prepared against the wrong entry' } });
  fireEvent.click(confirmButton(dialog, 'reject'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(writes(DECIDE).map(([, body]) => body)).toEqual([
    {
      appointment: 'appointment-a',
      kind: 'reject',
      reason: 'Prepared against the wrong entry',
      idempotencyKey: KEY(2),
      previewDigest: 'd'.repeat(64),
      confirmation: true,
    },
  ]);
});

it.each([
  ['an application without its compensating entry', 'apply' as const, { appliedEntry: null }],
  ['a decision under another retry key', 'approve' as const, {}],
])('refuses %s as a receipt and leaves the corrections as they were', async (_what, kind, change) => {
  decideFor = async (body) => ({
    data: { ...decided(kind === 'approve' ? { ...body, idempotencyKey: KEY(99) } : body), ...change },
  });
  await openClass();
  const list = await corrections();
  const before = [reads(CORRECTIONS), reads(HOLDERS)];
  const dialog = await openDecision(records(list)[0], kind);
  await previewed(dialog);
  fireEvent.click(confirmButton(dialog, kind));
  expect((await within(dialog).findByRole('alert')).textContent).toBe(COPY.DECISION_RECEIPT_FAILED);
  expect([reads(CORRECTIONS), reads(HOLDERS)]).toEqual(before);
  expect(within(list).getByText(COPY.STAGES.submitted)).toBeTruthy();
  expect(confirmButton(dialog, kind).disabled).toBe(true);
});

it('shows a refused decision and refreshes the corrections, entries, register and appointments after a conflict', async () => {
  decideFor = async () => {
    throw {
      response: {
        status: 409,
        data: { detail: 'The register operation conflicts with its recorded identity or holdings.' },
      },
    };
  };
  await openClass();
  const list = await corrections();
  await history();
  const before = [reads(CORRECTIONS), reads(HOLDERS), reads(APPOINTMENTS), reads(ENTRIES)];
  const dialog = await openDecision(records(list)[0], 'apply');
  await previewed(dialog);
  fireEvent.click(confirmButton(dialog, 'apply'));
  expect((await within(dialog).findByRole('alert')).textContent).toBe(
    'The register operation conflicts with its recorded identity or holdings.',
  );
  await waitFor(() =>
    expect([reads(CORRECTIONS), reads(HOLDERS), reads(APPOINTMENTS), reads(ENTRIES)]).toEqual([
      before[0] + 1,
      before[1] + 1,
      before[2] + 1,
      before[3] + 3,
    ]),
  );
});

it('words a refused decision by the requirements the server says it lacks', async () => {
  decideFor = async () => {
    throw { response: { status: 400, data: { unmetRequirements: ['entry_already_corrected', 'register_changed'] } } };
  };
  await openClass();
  const dialog = await openDecision(records(await corrections())[0], 'apply');
  await previewed(dialog);
  fireEvent.click(confirmButton(dialog, 'apply'));
  expect((await within(dialog).findByRole('alert')).textContent).toBe(
    `${REGISTER_CORRECTION_UNMET_COPY.entry_already_corrected} ${REGISTER_CORRECTION_UNMET_COPY.register_changed}`,
  );
});

it.each([
  [404, 'Company appointment not found.', true],
  [400, 'Choose approval, application or rejection.', true],
  [undefined, 'Unable to connect to our servers.', false],
] as const)(
  'after a preview failing with %s shows why, refreshing the corrections and appointments only on a refusal: %s',
  async (status, message, refreshes) => {
    previewFor = () => {
      throw status
        ? { response: { status, data: { detail: message } } }
        : Object.assign(new Error(message), { isUserFriendly: true });
    };
    await openClass();
    const list = await corrections();
    const before = [reads(CORRECTIONS), reads(HOLDERS), reads(APPOINTMENTS)];
    const dialog = await openDecision(records(list)[0], 'approve');
    expect((await within(dialog).findByRole('alert')).textContent).toBe(message);
    await waitFor(() => expect(within(dialog).queryByText('Loading the preview…')).toBeNull());
    await waitFor(() =>
      expect([reads(CORRECTIONS), reads(HOLDERS), reads(APPOINTMENTS)]).toEqual(
        refreshes ? before.map((count) => count + 1) : before,
      ),
    );
    expect(confirmButton(dialog, 'approve').disabled).toBe(true);
  },
);

it('retries an unconfirmed decision with the same key and takes a new key once the preview changes', async () => {
  decideFor = async () => {
    throw Object.assign(new Error('Unable to connect to our servers.'), { isUserFriendly: true });
  };
  await openClass();
  const [record] = records(await corrections());
  const confirmOnce = async () => {
    const dialog = await openDecision(record, 'approve');
    await previewed(dialog);
    fireEvent.click(confirmButton(dialog, 'approve'));
    await within(dialog).findByRole('alert');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  };
  await confirmOnce();
  await confirmOnce();
  previewFor = () => preview({ previewDigest: 'e'.repeat(64) });
  await confirmOnce();
  expect(writes(DECIDE).map(([, body]) => [body.idempotencyKey, body.previewDigest])).toEqual([
    [KEY(1), DIGEST],
    [KEY(1), DIGEST],
    [KEY(2), 'e'.repeat(64)],
  ]);
});

it('drops a preview that returns after the signed-in account changed', async () => {
  const pending = deferred<{ data: RegisterCorrectionDecisionPreview }>();
  api.post.mockImplementation((url: string) => (url === PREVIEW ? pending.promise : Promise.reject(new Error(url))));
  await openClass();
  fireEvent.click(within(records(await corrections())[0]).getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(writes(PREVIEW)).toHaveLength(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: preview() }));
  expect(screen.queryByText('Register sequence')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Approve correction' })).toBeNull();
  expect(writes(DECIDE)).toHaveLength(0);
});

it('records nothing on the page or in the cache when a decision returns after the signed-in account changed', async () => {
  const pending = deferred<{ data: RegisterCorrection }>();
  decideFor = () => pending.promise;
  await openClass();
  const dialog = await openDecision(records(await corrections())[0], 'apply');
  await previewed(dialog);
  const before = [reads(CORRECTIONS), reads(HOLDERS), reads(APPOINTMENTS)];
  fireEvent.click(confirmButton(dialog, 'apply'));
  await waitFor(() => expect(writes(DECIDE)).toHaveLength(1));
  correctionPages = [page([])];
  act(switchAccount);
  const body = writes(DECIDE)[0][1] as RegisterCorrectionDecideRequest;
  await act(async () => pending.resolve({ data: decided(body) }));
  expect([reads(CORRECTIONS), reads(HOLDERS), reads(APPOINTMENTS)]).toEqual(before);
  expect(client.getQueryState([...ACCOUNT, 'corrections', 'ordinary'])?.isInvalidated).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps each account to its own entries and corrections, showing none of the previous account while its own load', async () => {
  await openClass();
  expect(within(await corrections()).getByText('Example Preparer')).toBeTruthy();
  expect(within(await history()).getByText('Entry 4')).toBeTruthy();
  const entriesPending = deferred<Paged<RegisterEntry>>();
  const correctionsPending = deferred<Paged<RegisterCorrection>>();
  serve((url) => {
    if (url === APPOINTMENTS) return page([]);
    if (url === ENTRIES) return entriesPending.promise;
    if (url === CORRECTIONS) return correctionsPending.promise;
    return undefined;
  });
  act(switchAccount);
  fireEvent.click(await screen.findByRole('button', { name: /Ordinary shares/ }));
  expect(await screen.findByText('Loading register entries…')).toBeTruthy();
  expect(screen.getByText('Loading corrections…')).toBeTruthy();
  expect(screen.queryByText('Example Preparer')).toBeNull();
  expect(screen.queryByText('Entry 4')).toBeNull();
  await act(async () => {
    entriesPending.resolve(page([]));
    correctionsPending.resolve(page([]));
  });
  expect(await screen.findByText(COPY.EMPTY)).toBeTruthy();
  expect(screen.getByText(COPY.ENTRIES_EMPTY)).toBeTruthy();
  expect(client.getQueryData(['tokens', 'register', 'profile-two', 'account-two', 'corrections', 'ordinary'])).toEqual(
    [],
  );
});

it('downloads the authority document under its retained name, or a named fallback', async () => {
  const saved = stubDownloads();
  correctionPages = [page([correction(), staffEra({ uuid: 'correction-staff' })])];
  await openClass();
  const [company, staff] = records(await corrections());
  fireEvent.click(within(company).getByRole('button', { name: COPY.DOWNLOAD }));
  await waitFor(() => expect(saved).toEqual(['signed-resolution.pdf']));
  fireEvent.click(within(staff).getByRole('button', { name: COPY.DOWNLOAD }));
  await waitFor(() => expect(saved).toEqual(['signed-resolution.pdf', 'register-correction-correction-staff']));
  expect(api.get).toHaveBeenCalledWith(FILE, { ledovaSubmissionGuard: expect.any(Function), responseType: 'blob' });
});

it('says when the authority document could not be downloaded', async () => {
  serve((url) => (url === FILE ? Promise.reject(new Error('Unavailable')) : undefined));
  await openClass();
  const [record] = records(await corrections());
  fireEvent.click(within(record).getByRole('button', { name: COPY.DOWNLOAD }));
  expect((await within(record).findByRole('alert')).textContent).toBe('The file could not be downloaded. Try again.');
});

it('saves no authority document whose download returns after the signed-in account changed', async () => {
  const saved = stubDownloads();
  const pending = deferred<{ data: Blob }>();
  await openClass();
  const [record] = records(await corrections());
  serve((url) => (url === FILE ? pending.promise : undefined));
  fireEvent.click(within(record).getByRole('button', { name: COPY.DOWNLOAD }));
  await waitFor(() => expect(reads(FILE)).toBe(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: new Blob(['%PDF synthetic']) }));
  expect(saved).toEqual([]);
});

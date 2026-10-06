// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  COMPANY_TOKEN_ENDPOINTS,
  REGISTER_CORRECTION_COPY,
  REGISTER_OPENING_COPY,
  REGISTER_OPENING_UNMET_COPY,
  USER_PREFERENCES_QUERY_KEY,
  formatDateTime,
  type AccountRole,
  type CompanyCapability,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterEntry,
  type RegisterOpeningDecideRequest,
  type RegisterOpeningDecisionPreview,
  type RegisterOpeningRecord,
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
const OPENINGS = COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENINGS;
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const PREVIEW = COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENING_PREVIEW('opening-new');
const DECIDE = COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENING_DECIDE('opening-new');
const FILE = COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENING_FILE('opening-new');
const ACCOUNT = ['tokens', 'register', 'profile-one', 'account-one'];
const OPENINGS_KEY = [...ACCOUNT, 'openings', 'ordinary'];
const APPOINTMENTS_KEY = ['company-appointments', 'profile-one', 'account-one'];
const DIGEST = 'a'.repeat(64);
const COPY = REGISTER_OPENING_COPY;
const KEY = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const NEXT = (page: number) => `https://example.test/tokens/register-openings/?page=${page}`;
const LISTED = { uuid: 'ordinary', companyUuid: 'harbour', companyName: 'Harbour Example Pty Ltd' };
const ADA = `0x${'a'.repeat(40)}`;
const BO = `0x${'b'.repeat(40)}`;
const CY = `0x${'c'.repeat(40)}`;
const DEE = `0x${'d'.repeat(40)}`;
const MEMBER_ADA = '10000000-0000-4000-8000-0000000000aa';
const NEW_ONE = '20000000-0000-4000-8000-000000000001';
const NEW_TWO = '20000000-0000-4000-8000-000000000002';
const PREPARED = '2026-10-05T01:00:00Z';
const CONTEXT = `opening prepared ${formatDateTime(PREPARED)}`;
let client: QueryClient;
let classRegister: TokenHoldersResponse;
let appointments: OwnCompanyAppointment[];
let openingPages: Paged<RegisterOpeningRecord>[];
let entries: RegisterEntry[];
let previewFor: (body: { kind: RegisterDecisionKind; reason: string }) => RegisterOpeningDecisionPreview;
let decideFor: (body: RegisterOpeningDecideRequest) => Promise<{ data: RegisterOpeningRecord }>;

type Paged<T> = { data: { results: T[]; count: number; next: string | null; previous: null } };
type ReadConfig = { params?: { page?: number; token?: string } };

function unopened(overrides: Partial<TokenHoldersResponse['token']> = {}): TokenHoldersResponse {
  return {
    token: {
      uuid: 'ordinary',
      name: 'Ordinary shares',
      symbol: 'ORD',
      status: 'deployed',
      totalSupply: '9007199254741999',
      ...overrides,
    },
    initialized: false,
    issuedSupply: null,
    waitingEffects: null,
    holders: [],
    totalHolders: 0,
    formerMembers: [],
    formerMembersAsAt: null,
    formerMembersBlock: null,
    formerMembersStale: false,
  };
}

function opened(): TokenHoldersResponse {
  return {
    ...unopened(),
    initialized: true,
    issuedSupply: '20',
    waitingEffects: 0,
    holders: [
      {
        member: MEMBER_ADA,
        name: 'Ada Member',
        holderType: 'member',
        balance: '20',
        shareClass: 'ORD',
        source: 'register',
        identitySource: 'stamp',
        enteredOn: '2026-09-20',
        percentage: 100,
        wallets: [{ address: ADA, whitelistStatus: 'Active' }],
      },
    ],
    totalHolders: 1,
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

function opening(overrides: Partial<RegisterOpeningRecord> = {}): RegisterOpeningRecord {
  return {
    uuid: 'opening-new',
    company: 'harbour',
    token: 'ordinary',
    mapping: [
      { address: ADA, member: MEMBER_ADA },
      { address: BO, member: NEW_ONE },
      { address: CY, member: NEW_ONE },
      { address: DEE, member: NEW_TWO },
    ],
    boundary: {},
    boundarySummary: {
      blockNumber: 12,
      blockHash: `0x${'e'.repeat(64)}`,
      date: '2026-09-20',
      holdings: [
        { address: ADA, shares: '20', member: MEMBER_ADA, memberName: 'Ada Member', memberExists: true },
        { address: BO, shares: '9007199254740993', member: NEW_ONE, memberName: null, memberExists: false },
        { address: DEE, shares: '5', member: NEW_TWO, memberName: null, memberExists: false },
        { address: CY, shares: '5', member: NEW_ONE, memberName: null, memberExists: false },
      ],
    },
    authority: 'director_resolution',
    approvingDirector: 'Example Director',
    authorityReference: 'RESOLUTION-OPENING-1',
    reason: 'Open the register from the chain',
    sourceDocument: null,
    evidenceFingerprint: 'f'.repeat(64),
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
    createdAt: PREPARED,
    ...overrides,
  };
}

function staffEra(overrides: Partial<RegisterOpeningRecord> = {}) {
  return opening({
    uuid: 'opening-staff',
    boundary: null,
    boundarySummary: null,
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

function preview(overrides: Partial<RegisterOpeningDecisionPreview> = {}): RegisterOpeningDecisionPreview {
  return {
    previewDigest: DIGEST,
    unmetRequirements: [],
    canDecide: true,
    changes: [
      { member: MEMBER_ADA, shares: '20' },
      { member: NEW_ONE, shares: '9007199254740998' },
      { member: NEW_TWO, shares: '5' },
    ],
    effectiveOn: '2026-09-20',
    ...overrides,
  };
}

function decided(request: RegisterOpeningDecideRequest, base = opening()): RegisterOpeningRecord {
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
      ? { status: 'applied' as const, stage: 'applied', reviewedAt: decision.decidedAt, appliedEntry: 'entry-opening' }
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

function serve(read?: (url: string, config?: ReadConfig) => unknown) {
  api.get.mockImplementation(async (url: string, config?: ReadConfig) => {
    const answer = read?.(url, config);
    if (answer !== undefined) return answer;
    if (url === REGISTER) return page([LISTED]);
    if (url === HOLDERS) return { data: classRegister };
    if (url === APPOINTMENTS) return page(appointments);
    if (url === OPENINGS) return openingPages[(config?.params?.page ?? 1) - 1];
    if (url === ENTRIES) return page(entries);
    if (url === IMPORTS || url === CORRECTIONS || url === RECONCILIATIONS) return page([]);
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

async function openings() {
  return section(COPY.TITLE);
}

function records(element: HTMLElement) {
  return [...element.querySelectorAll(':scope > ul > li')] as HTMLElement[];
}

function holdings(record: HTMLElement) {
  return [...record.querySelectorAll('ul li')].map((item) =>
    [...item.querySelectorAll('span')].map((span) => span.textContent),
  );
}

function rowText(element: HTMLElement, label: string) {
  return within(element).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
}

function lines(element: HTMLElement, label: string) {
  return [...within(element).getByText(label, { selector: 'dt' }).nextElementSibling!.children].map(
    (line) => line.textContent,
  );
}

function action(label: string) {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(`);
}

function decisionLabels(record: HTMLElement) {
  return within(record)
    .queryAllByRole('button', { name: /^(Approve|Apply|Reject) \(/ })
    .map((button) => button.textContent?.split(' (')[0]);
}

async function openDecision(record: HTMLElement, kind: RegisterDecisionKind) {
  fireEvent.click(within(record).getByRole('button', { name: action(COPY.DECISIONS[kind]) }));
  return screen.findByRole('dialog', { name: `${COPY.DECISIONS[kind]} opening` });
}

function confirmButton(dialog: HTMLElement, kind: RegisterDecisionKind) {
  return within(dialog).getByRole('button', { name: `${COPY.DECISIONS[kind]} opening` }) as HTMLButtonElement;
}

async function previewed(dialog: HTMLElement) {
  await within(dialog).findByText('Opening entry');
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
  classRegister = unopened();
  appointments = [appointment(['admin'])];
  openingPages = [page([opening()])];
  entries = [];
  previewFor = () => preview();
  decideFor = async (body) => ({ data: decided(body) });
  serve();
  api.post.mockImplementation(async (url: string, body: RegisterOpeningDecideRequest) => {
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

it("lists every page of the class's openings newest first, each once, with their boundary, mapping and particulars", async () => {
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
  const applied = opening({
    uuid: 'opening-applied',
    authority: 'court_order',
    approvingDirector: '',
    authorityReference: 'COURT-ORDER-7',
    reason: 'Open the register the court directed',
    status: 'applied',
    stage: 'applied',
    reviewedAt: application.decidedAt,
    appliedEntry: 'entry-opening',
    decisions: [application, approval],
    createdAt: '2026-10-02T01:00:00Z',
  });
  const retired = staffEra({
    status: 'rejected',
    stage: 'rejected',
    rejectionReason: 'Superseded by the company-run opening',
    reviewedAt: '2026-09-30T05:00:00Z',
  });
  openingPages = [page([retired, applied], NEXT(2)), page([applied, opening()])];
  await openClass();
  const list = await openings();
  expect(api.get).toHaveBeenCalledWith(OPENINGS, {
    params: { token: 'ordinary', page: 1 },
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(api.get).toHaveBeenCalledWith(OPENINGS, {
    params: { token: 'ordinary', page: 2 },
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(records(list)).toHaveLength(3);
  const [newest, middle, oldest] = records(list);
  expect(
    within(newest)
      .getAllByRole('term')
      .map((term) => term.textContent),
  ).toEqual([
    'Stage',
    'Prepared by',
    'Prepared on',
    COPY.BOUNDARY,
    COPY.AUTHORITY,
    COPY.APPROVING_DIRECTOR,
    COPY.AUTHORITY_REFERENCE,
    COPY.REASON,
  ]);
  expect(rowText(newest, 'Stage')).toBe(COPY.STAGES.submitted);
  expect(rowText(newest, 'Prepared by')).toBe('Example Preparer');
  expect(rowText(newest, 'Prepared on')).toBe(formatDateTime(PREPARED));
  expect(rowText(newest, COPY.BOUNDARY)).toBe(COPY.BOUNDARY_BLOCK(12, '2026-09-20'));
  expect(rowText(newest, COPY.AUTHORITY)).toBe(COPY.AUTHORITIES.director_resolution);
  expect(rowText(newest, COPY.APPROVING_DIRECTOR)).toBe('Example Director');
  expect(rowText(newest, COPY.AUTHORITY_REFERENCE)).toBe('RESOLUTION-OPENING-1');
  expect(rowText(newest, COPY.REASON)).toBe('Open the register from the chain');
  expect(within(newest).getByText(COPY.HOLDINGS)).toBeTruthy();
  expect(holdings(newest)).toEqual([
    [COPY.NEW_MEMBER_NUMBERED(1), '9,007,199,254,740,993 shares', BO],
    ['Ada Member', '20 shares', ADA],
    [COPY.NEW_MEMBER_NUMBERED(1), '5 shares', CY],
    [COPY.NEW_MEMBER_NUMBERED(2), '5 shares', DEE],
  ]);
  expect(within(newest).getByText(COPY.PROVIDED_BY_COMPANY)).toBeTruthy();
  expect(within(newest).queryByText('Decided on')).toBeNull();

  expect(rowText(middle, 'Stage')).toBe(COPY.STAGES.applied);
  expect(rowText(middle, COPY.AUTHORITY)).toBe(COPY.AUTHORITIES.court_order);
  expect(within(middle).queryByText(COPY.APPROVING_DIRECTOR)).toBeNull();
  const trail = within(middle)
    .getAllByRole('term')
    .map((term) => term.textContent);
  expect(trail.indexOf('Approve')).toBeLessThan(trail.indexOf('Apply'));
  expect(rowText(middle, 'Approve')).toBe(`Example Approver · ${formatDateTime(approval.decidedAt)}`);
  expect(rowText(middle, 'Apply')).toBe(`Example Approver · ${formatDateTime(application.decidedAt)}`);
  expect(within(middle).queryByText('Decided on')).toBeNull();

  expect(within(oldest).getByText(COPY.STAFF_VERIFIED)).toBeTruthy();
  expect(within(oldest).queryByText(COPY.PROVIDED_BY_COMPANY)).toBeNull();
  expect(within(oldest).queryByText('Prepared by')).toBeNull();
  expect(rowText(oldest, COPY.BOUNDARY)).toBe('Not captured');
  expect(within(oldest).queryByText(COPY.HOLDINGS)).toBeNull();
  expect(rowText(oldest, 'Rejection reason')).toBe('Superseded by the company-run opening');
  expect(rowText(oldest, 'Decided on')).toBe(formatDateTime('2026-09-30T05:00:00Z'));
  for (const record of [newest, middle, oldest])
    expect(within(record).getByRole('button', { name: action(COPY.DOWNLOAD) })).toBeTruthy();
  expect(client.getQueryData<{ uuid: string }[]>(OPENINGS_KEY)?.map(({ uuid }) => uuid)).toEqual([
    'opening-new',
    'opening-applied',
    'opening-staff',
  ]);
});

it('says an opening whose boundary held no shares records an empty register', async () => {
  openingPages = [page([opening({ mapping: [], boundarySummary: { ...opening().boundarySummary!, holdings: [] } })])];
  await openClass();
  const [record] = records(await openings());
  expect(within(record).getByText(COPY.NO_HOLDINGS)).toBeTruthy();
  expect(holdings(record)).toEqual([]);
});

it('says calmly that a class has no openings yet', async () => {
  openingPages = [page([])];
  await openClass();
  expect(within(await openings()).getByText(COPY.EMPTY)).toBeTruthy();
});

it.each([
  ['deployed', true],
  ['paused', true],
  ['draft', false],
  ['deploying', false],
])('lists openings for a %s class only when it is on chain: %s', async (status, listed) => {
  classRegister = unopened({ status });
  await openClass();
  await section(REGISTER_CORRECTION_COPY.ENTRIES_TITLE);
  expect(!!screen.queryByRole('heading', { level: 3, name: COPY.TITLE })).toBe(listed);
  expect(reads(OPENINGS)).toBe(listed ? 1 : 0);
  expect(!!screen.queryByRole('link', { name: COPY.PREPARE })).toBe(listed);
});

it.each([
  ['administration on an unopened class', ['admin'], unopened, true],
  ['prepare on an unopened class', ['prepare'], unopened, true],
  ['approve and apply on an unopened class', ['approve', 'apply'], unopened, false],
  ['administration on an opened class', ['admin'], opened, false],
] as const)('offers Open this register to %s: %s', async (_who, held, state, offered) => {
  appointments = [appointment([...held])];
  classRegister = state();
  await openClass();
  const link = within(await openings()).queryByRole('link', { name: COPY.PREPARE });
  expect(link?.getAttribute('href') ?? null).toBe(offered ? '/company/register/ordinary/open' : null);
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
] as const)('shows %s the openings with the read-only note and no steps', async (_who, role, held) => {
  appointments = [...held];
  await openClass(role);
  const list = await openings();
  expect(within(list).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(within(list).getByText('Example Preparer')).toBeTruthy();
  expect(decisionLabels(records(list)[0])).toEqual([]);
  expect(within(list).queryByRole('link', { name: COPY.PREPARE })).toBeNull();
  expect(within(list).getByRole('button', { name: action(COPY.DOWNLOAD) })).toBeTruthy();
});

it.each([
  ['admin', ['Approve', 'Apply', 'Reject']],
  ['prepare', []],
  ['approve', ['Approve', 'Reject']],
  ['apply', ['Apply']],
] as const)('offers an appointment holding %s exactly its opening steps', async (held, steps) => {
  appointments = [appointment([held])];
  await openClass();
  const list = await openings();
  expect(decisionLabels(records(list)[0])).toEqual(steps);
  expect(within(list).queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
});

it('offers a retained staff-era opening only rejection', async () => {
  openingPages = [page([staffEra()])];
  await openClass();
  const list = await openings();
  expect(decisionLabels(records(list)[0])).toEqual(['Reject']);
  expect(within(list).getByText(COPY.STAFF_VERIFIED)).toBeTruthy();
});

it.each(['applied', 'rejected'] as const)('offers no step on an opening already %s', async (status) => {
  openingPages = [page([opening({ status, stage: status })])];
  await openClass();
  expect(decisionLabels(records(await openings())[0])).toEqual([]);
});

it('names each repeated control after its visible label, then when its opening was prepared', async () => {
  await openClass();
  const [record] = records(await openings());
  expect(
    within(record)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual([`${COPY.DOWNLOAD} (${CONTEXT})`, `Approve (${CONTEXT})`, `Apply (${CONTEXT})`, `Reject (${CONTEXT})`]);
  expect(within(record).getByRole('button', { name: `Approve (${CONTEXT})` })).toBeTruthy();
  expect(within(record).getAllByText(`(${CONTEXT})`, { selector: '.sr-only' })).toHaveLength(4);
  expect(within(record).getByText(COPY.DECISIONS.approve).className).toBe('');
});

it('previews an approval with the opening entry by member, then records exactly that decision and refreshes', async () => {
  await openClass();
  const list = await openings();
  await section(REGISTER_CORRECTION_COPY.ENTRIES_TITLE);
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
  expect(rowText(dialog, 'Effective on')).toBe('2026-09-20');
  expect(lines(dialog, 'Opening entry')).toEqual([
    'Ada Member: +20',
    `${COPY.NEW_MEMBER_NUMBERED(1)}: +9,007,199,254,740,998`,
    `${COPY.NEW_MEMBER_NUMBERED(2)}: +5`,
  ]);
  expect(within(dialog).queryByText(COPY.HOLDINGS_NOTE)).toBeNull();
  const before = [reads(OPENINGS), reads(HOLDERS), reads(ENTRIES), reads(APPOINTMENTS)];
  openingPages = [
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
    expect([reads(OPENINGS), reads(HOLDERS), reads(ENTRIES), reads(APPOINTMENTS)]).toEqual(
      before.map((count) => count + 1),
    ),
  );
  expect(await within(list).findByText(COPY.STAGES.approved)).toBeTruthy();
  expect(rowText(list, 'Approve')).toBe(`Example Decider · ${formatDateTime('2026-10-05T02:00:00Z')}`);
});

it("opens the register on an applied opening, showing the class's members and its opening entry", async () => {
  await openClass();
  const list = await openings();
  const history = await section(REGISTER_CORRECTION_COPY.ENTRIES_TITLE);
  expect(within(list).getByRole('link', { name: COPY.PREPARE })).toBeTruthy();
  expect(within(history).getByText(REGISTER_CORRECTION_COPY.ENTRIES_EMPTY)).toBeTruthy();
  const dialog = await openDecision(records(list)[0], 'apply');
  await previewed(dialog);
  classRegister = opened();
  entries = [
    {
      uuid: 'entry-opening',
      sequence: 1,
      kind: 'opening',
      effectiveOn: '2026-09-20',
      recordedAt: '2026-10-05T02:00:00Z',
      changes: [{ member: MEMBER_ADA, name: 'Ada Member', shares: '20' }],
      corrects: null,
      correctedBy: null,
      correctable: true,
    },
  ];
  fireEvent.click(confirmButton(dialog, 'apply'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByRole('heading', { level: 3, name: 'Current members · 1' })).toBeTruthy();
  expect(await within(history).findByText(REGISTER_CORRECTION_COPY.ENTRY_KINDS.opening)).toBeTruthy();
  expect(within(history).getByText('Ada Member: +20')).toBeTruthy();
  expect(within(list).queryByRole('link', { name: COPY.PREPARE })).toBeNull();
});

it.each([
  ['apply', true],
  ['approve', false],
  ['reject', false],
] as const)('notes that the holdings become the first entry when previewing %s: %s', async (kind, shown) => {
  await openClass();
  const dialog = await openDecision(records(await openings())[0], kind);
  await previewed(dialog);
  expect(!!within(dialog).queryByText(COPY.HOLDINGS_NOTE)).toBe(shown);
});

it('says an application records an empty register when the boundary held no shares', async () => {
  previewFor = () => preview({ changes: [] });
  await openClass();
  const dialog = await openDecision(records(await openings())[0], 'apply');
  await previewed(dialog);
  expect(rowText(dialog, 'Opening entry')).toBe(COPY.NO_HOLDINGS);
});

it('shows no opening entry for a staff-era opening whose boundary was never captured', async () => {
  openingPages = [page([staffEra({ uuid: 'opening-new' })])];
  previewFor = () =>
    preview({ changes: [], effectiveOn: null, canDecide: false, unmetRequirements: ['reason_required'] });
  await openClass();
  const dialog = await openDecision(records(await openings())[0], 'reject');
  expect(await within(dialog).findByText(REGISTER_OPENING_UNMET_COPY.reason_required)).toBeTruthy();
  expect(within(dialog).queryByText('Opening entry')).toBeNull();
  expect(within(dialog).queryByText('Effective on')).toBeNull();
});

it('opens one decision at a time', async () => {
  await openClass();
  const [record] = records(await openings());
  const dialog = await openDecision(record, 'approve');
  await previewed(dialog);
  fireEvent.click(within(record).getByRole('button', { name: action(COPY.DECISIONS.apply) }));
  expect(screen.getByRole('dialog', { name: 'Approve opening' })).toBeTruthy();
  expect(screen.queryByRole('dialog', { name: 'Apply opening' })).toBeNull();
  expect(writes(PREVIEW).map(([, body]) => body.kind)).toEqual(['approve']);
});

it('previews and records each step under the appointment that holds it', async () => {
  appointments = [
    appointment(['approve'], { uuid: 'appointment-b' }),
    appointment(['apply'], { uuid: 'appointment-c' }),
  ];
  await openClass();
  let dialog = await openDecision(records(await openings())[0], 'apply');
  await previewed(dialog);
  fireEvent.click(confirmButton(dialog, 'apply'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  openingPages = [page([opening()])];
  await act(async () => {
    await client.refetchQueries({ queryKey: OPENINGS_KEY });
  });
  dialog = await openDecision(records(await openings())[0], 'reject');
  await previewed(dialog);
  expect(writes(PREVIEW).map(([, body]) => body.appointment)).toEqual(['appointment-c', 'appointment-b']);
  expect(writes(DECIDE).map(([, body]) => body.appointment)).toEqual(['appointment-c']);
});

it('lists unmet requirements in words and keeps the decision unconfirmable while any remain', async () => {
  previewFor = () =>
    preview({ canDecide: false, unmetRequirements: ['boundary_changed', 'wallet_linked_elsewhere', 'future_rule'] });
  await openClass();
  const dialog = await openDecision(records(await openings())[0], 'apply');
  expect(await within(dialog).findByText(REGISTER_OPENING_UNMET_COPY.boundary_changed)).toBeTruthy();
  expect(within(dialog).getByText(REGISTER_OPENING_UNMET_COPY.wallet_linked_elsewhere)).toBeTruthy();
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
  const dialog = await openDecision(records(await openings())[0], 'approve');
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

it('withdraws every step and the opening link once a refresh shows the appointment revoked', async () => {
  await openClass();
  const list = await openings();
  expect(decisionLabels(records(list)[0])).toEqual(['Approve', 'Apply', 'Reject']);
  expect(within(list).getByRole('link', { name: COPY.PREPARE })).toBeTruthy();
  appointments = [appointment(['admin'], { status: 'revoked', isEffective: false, revokedAt: '2026-10-05T03:00:00Z' })];
  await act(async () => {
    await client.refetchQueries({ queryKey: APPOINTMENTS_KEY });
  });
  await waitFor(() => expect(decisionLabels(records(list)[0])).toEqual([]));
  expect(within(list).queryByRole('link', { name: COPY.PREPARE })).toBeNull();
  expect(within(list).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('withholds every step and the opening link while the appointments cannot be read, and offers their retry', async () => {
  let fail = true;
  serve((url) => (url === APPOINTMENTS && fail ? Promise.reject(new Error('Unavailable')) : undefined));
  await openClass();
  const list = await openings();
  await waitFor(() =>
    expect(within(list).getByRole('alert').textContent).toContain(
      'Your appointments could not be loaded. Retry before preparing or deciding an opening.',
    ),
  );
  expect(decisionLabels(records(list)[0])).toEqual([]);
  expect(within(list).queryByRole('link', { name: COPY.PREPARE })).toBeNull();
  expect(within(list).queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
  fail = false;
  fireEvent.click(within(list).getByRole('button', { name: 'Retry appointments' }));
  await waitFor(() => expect(decisionLabels(records(list)[0])).toEqual(['Approve', 'Apply', 'Reject']));
  expect(within(list).getByRole('link', { name: COPY.PREPARE })).toBeTruthy();
});

it('previews a rejection again with its reason and records exactly that reason', async () => {
  previewFor = ({ reason }) =>
    reason
      ? preview({ previewDigest: 'd'.repeat(64) })
      : preview({ canDecide: false, unmetRequirements: ['reason_required'] });
  await openClass();
  const dialog = await openDecision(records(await openings())[0], 'reject');
  expect(await within(dialog).findByText(REGISTER_OPENING_UNMET_COPY.reason_required)).toBeTruthy();
  expect(within(dialog).getByText(COPY.CONFIRMATIONS.reject)).toBeTruthy();
  const reason = within(dialog).getByLabelText(COPY.REJECTION_REASON) as HTMLTextAreaElement;
  expect(reason.maxLength).toBe(1000);
  const again = within(dialog).getByRole('button', { name: 'Preview the rejection' }) as HTMLButtonElement;
  expect(confirmButton(dialog, 'reject').disabled).toBe(true);
  fireEvent.change(reason, { target: { value: '  The holdings moved before approval  ' } });
  fireEvent.click(again);
  await waitFor(() => expect(confirmButton(dialog, 'reject').disabled).toBe(false));
  fireEvent.click(confirmButton(dialog, 'reject'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(writes(PREVIEW).map(([, body]) => body)).toEqual([
    { appointment: 'appointment-a', kind: 'reject', reason: '' },
    { appointment: 'appointment-a', kind: 'reject', reason: 'The holdings moved before approval' },
  ]);
  expect(writes(DECIDE).map(([, body]) => body)).toEqual([
    {
      appointment: 'appointment-a',
      kind: 'reject',
      reason: 'The holdings moved before approval',
      idempotencyKey: KEY(2),
      previewDigest: 'd'.repeat(64),
      confirmation: true,
    },
  ]);
});

it('refuses an unconfirmed decision receipt and leaves the openings as they were', async () => {
  decideFor = async (body) => ({ data: decided({ ...body, idempotencyKey: KEY(99) }) });
  await openClass();
  const list = await openings();
  const before = [reads(OPENINGS), reads(HOLDERS)];
  const dialog = await openDecision(records(list)[0], 'apply');
  await previewed(dialog);
  fireEvent.click(confirmButton(dialog, 'apply'));
  expect((await within(dialog).findByRole('alert')).textContent).toBe(COPY.DECISION_RECEIPT_FAILED);
  expect([reads(OPENINGS), reads(HOLDERS)]).toEqual(before);
  expect(rowText(list, 'Stage')).toBe(COPY.STAGES.submitted);
  expect(confirmButton(dialog, 'apply').disabled).toBe(true);
});

it('shows a refused decision and refreshes the openings, register, entries and appointments after a conflict', async () => {
  decideFor = async () => {
    throw {
      response: { status: 409, data: { detail: 'The register operation conflicts with its recorded identity.' } },
    };
  };
  await openClass();
  const list = await openings();
  await section(REGISTER_CORRECTION_COPY.ENTRIES_TITLE);
  const before = [reads(OPENINGS), reads(HOLDERS), reads(ENTRIES), reads(APPOINTMENTS)];
  const dialog = await openDecision(records(list)[0], 'apply');
  await previewed(dialog);
  fireEvent.click(confirmButton(dialog, 'apply'));
  expect((await within(dialog).findByRole('alert')).textContent).toBe(
    'The register operation conflicts with its recorded identity.',
  );
  await waitFor(() =>
    expect([reads(OPENINGS), reads(HOLDERS), reads(ENTRIES), reads(APPOINTMENTS)]).toEqual(
      before.map((count) => count + 1),
    ),
  );
});

it('words a refused decision by the requirements the server says it lacks', async () => {
  decideFor = async () => {
    throw { response: { status: 400, data: { unmetRequirements: ['register_initialized', 'boundary_changed'] } } };
  };
  await openClass();
  const dialog = await openDecision(records(await openings())[0], 'apply');
  await previewed(dialog);
  fireEvent.click(confirmButton(dialog, 'apply'));
  expect((await within(dialog).findByRole('alert')).textContent).toBe(
    `${REGISTER_OPENING_UNMET_COPY.register_initialized} ${REGISTER_OPENING_UNMET_COPY.boundary_changed}`,
  );
});

it.each([
  [404, 'Company appointment not found.', true],
  [400, 'Choose approval, application or rejection.', true],
  [undefined, 'Unable to connect to our servers.', false],
] as const)(
  'after a preview failing with %s shows why, refreshing the openings and appointments only on a refusal: %s',
  async (status, message, refreshes) => {
    previewFor = () => {
      throw status
        ? { response: { status, data: { detail: message } } }
        : Object.assign(new Error(message), { isUserFriendly: true });
    };
    await openClass();
    const list = await openings();
    const before = [reads(OPENINGS), reads(HOLDERS), reads(APPOINTMENTS)];
    const dialog = await openDecision(records(list)[0], 'approve');
    expect((await within(dialog).findByRole('alert')).textContent).toBe(message);
    await waitFor(() => expect(within(dialog).queryByText('Loading the preview…')).toBeNull());
    await waitFor(() =>
      expect([reads(OPENINGS), reads(HOLDERS), reads(APPOINTMENTS)]).toEqual(
        refreshes ? before.map((count) => count + 1) : before,
      ),
    );
    expect(confirmButton(dialog, 'approve').disabled).toBe(true);
  },
);

it('drops a preview that returns after the signed-in account changed', async () => {
  const pending = deferred<{ data: RegisterOpeningDecisionPreview }>();
  api.post.mockImplementation((url: string) => (url === PREVIEW ? pending.promise : Promise.reject(new Error(url))));
  await openClass();
  fireEvent.click(within(records(await openings())[0]).getByRole('button', { name: action('Approve') }));
  await waitFor(() => expect(writes(PREVIEW)).toHaveLength(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: preview() }));
  expect(screen.queryByText('Opening entry')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Approve opening' })).toBeNull();
  expect(writes(DECIDE)).toHaveLength(0);
});

it('records nothing on the page or in the cache when a decision returns after the signed-in account changed', async () => {
  const pending = deferred<{ data: RegisterOpeningRecord }>();
  decideFor = () => pending.promise;
  await openClass();
  const dialog = await openDecision(records(await openings())[0], 'apply');
  await previewed(dialog);
  const before = [reads(OPENINGS), reads(HOLDERS), reads(APPOINTMENTS)];
  fireEvent.click(confirmButton(dialog, 'apply'));
  await waitFor(() => expect(writes(DECIDE)).toHaveLength(1));
  openingPages = [page([])];
  act(switchAccount);
  const body = writes(DECIDE)[0][1] as RegisterOpeningDecideRequest;
  await act(async () => pending.resolve({ data: decided(body) }));
  expect([reads(OPENINGS), reads(HOLDERS), reads(APPOINTMENTS)]).toEqual(before);
  expect(client.getQueryState(OPENINGS_KEY)?.isInvalidated).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('refreshes nothing when a refused decision returns after the signed-in account changed', async () => {
  let refuse!: (failure: unknown) => void;
  decideFor = () =>
    new Promise((_resolve, reject) => {
      refuse = reject;
    });
  await openClass();
  const dialog = await openDecision(records(await openings())[0], 'apply');
  await previewed(dialog);
  fireEvent.click(confirmButton(dialog, 'apply'));
  await waitFor(() => expect(writes(DECIDE)).toHaveLength(1));
  act(switchAccount);
  await act(async () => refuse({ response: { status: 409, data: { detail: 'The register operation conflicts.' } } }));
  expect(client.getQueryState(OPENINGS_KEY)?.isInvalidated).toBe(false);
  expect(client.getQueryState(APPOINTMENTS_KEY)?.isInvalidated).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps no openings whose read returns after the signed-in account changed', async () => {
  const pending = deferred<Paged<RegisterOpeningRecord>>();
  serve((url) => (url === OPENINGS ? pending.promise : undefined));
  await openClass();
  expect(await screen.findByText('Loading openings…')).toBeTruthy();
  act(switchAccount);
  await act(async () => pending.resolve(page([opening()])));
  expect(client.getQueryData(OPENINGS_KEY)).toBeUndefined();
});

it('keeps each account to its own openings, showing none of the previous account while its own load', async () => {
  await openClass();
  expect(within(await openings()).getByText('Example Preparer')).toBeTruthy();
  const pending = deferred<Paged<RegisterOpeningRecord>>();
  serve((url) => {
    if (url === APPOINTMENTS) return page([]);
    if (url === OPENINGS) return pending.promise;
    return undefined;
  });
  act(switchAccount);
  fireEvent.click(await screen.findByRole('button', { name: /Ordinary shares/ }));
  expect(await screen.findByText('Loading openings…')).toBeTruthy();
  expect(screen.queryByText('Example Preparer')).toBeNull();
  await act(async () => pending.resolve(page([])));
  expect(await screen.findByText(COPY.EMPTY)).toBeTruthy();
  expect(client.getQueryData(['tokens', 'register', 'profile-two', 'account-two', 'openings', 'ordinary'])).toEqual([]);
});

it.each([
  ['names another share class', () => page([opening({ token: 'preference' })])],
  [
    'states holdings that are not whole shares',
    () =>
      page([
        opening({
          boundarySummary: {
            ...opening().boundarySummary!,
            holdings: [{ address: ADA, shares: '1.5', member: MEMBER_ADA, memberName: null, memberExists: true }],
          },
        }),
      ]),
  ],
  ['carries a mapping that cannot be read', () => page([opening({ mapping: [{ address: ADA }] })])],
])('refuses openings when one %s, and offers a retry', async (_why, answer) => {
  serve((url) => (url === OPENINGS ? answer() : undefined));
  await openClass();
  const list = await openings();
  expect(within(list).getByRole('alert').textContent).toContain("We couldn't load the openings for this share class.");
  expect(records(list)).toEqual([]);
  serve();
  fireEvent.click(within(list).getByRole('button', { name: 'Retry openings' }));
  await waitFor(() => expect(records(list)).toHaveLength(1));
});

it('downloads the authority document under its retained name, or a named fallback', async () => {
  const saved = stubDownloads();
  openingPages = [page([opening(), staffEra()])];
  await openClass();
  const [company, staff] = records(await openings());
  fireEvent.click(within(company).getByRole('button', { name: action(COPY.DOWNLOAD) }));
  await waitFor(() => expect(saved).toEqual(['signed-resolution.pdf']));
  fireEvent.click(within(staff).getByRole('button', { name: action(COPY.DOWNLOAD) }));
  await waitFor(() => expect(saved).toEqual(['signed-resolution.pdf', 'register-opening-opening-staff']));
  expect(api.get).toHaveBeenCalledWith(FILE, { ledovaSubmissionGuard: expect.any(Function), responseType: 'blob' });
});

it('says when the authority document could not be downloaded', async () => {
  serve((url) => (url === FILE ? Promise.reject(new Error('Unavailable')) : undefined));
  await openClass();
  const [record] = records(await openings());
  fireEvent.click(within(record).getByRole('button', { name: action(COPY.DOWNLOAD) }));
  expect((await within(record).findByRole('alert')).textContent).toBe('The file could not be downloaded. Try again.');
});

it('saves no authority document whose download returns after the signed-in account changed', async () => {
  const saved = stubDownloads();
  const pending = deferred<{ data: Blob }>();
  await openClass();
  const [record] = records(await openings());
  serve((url) => (url === FILE ? pending.promise : undefined));
  fireEvent.click(within(record).getByRole('button', { name: action(COPY.DOWNLOAD) }));
  await waitFor(() => expect(reads(FILE)).toBe(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: new Blob(['%PDF synthetic']) }));
  expect(saved).toEqual([]);
});

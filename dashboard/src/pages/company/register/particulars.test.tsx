// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  COMPANY_TOKEN_ENDPOINTS,
  DESTINATIONS,
  HOLDER_TYPE_LABELS,
  REGISTER_PARTICULARS_COPY,
  REGISTER_PARTICULARS_UNMET_COPY,
  USER_PREFERENCES_QUERY_KEY,
  formatDateTime,
  type CompanyCapability,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterParticularsChange,
  type RegisterParticularsChangeDecideRequest,
  type RegisterParticularsChangeDecisionPreview,
  type TokenHoldersResponse,
} from '@ledova/shared';
import CompanyRegisterPage from '.';
import { STEP_CHANGED } from './proposals';
import { companyPreferences, prepareCompanyClient, renderCompanyPage } from '../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

const REGISTER = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const HOLDERS = COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary');
const ENTRIES = COMPANY_TOKEN_ENDPOINTS.REGISTER_ENTRIES('ordinary');
const PARTICULARS = COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGES;
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const PREVIEW = COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGE_PREVIEW('change-ada');
const DECIDE = COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGE_DECIDE('change-ada');
const FILE = COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGE_FILE('change-ada');
const ACCOUNT = ['tokens', 'register', 'profile-one', 'account-one'];
const PARTICULARS_KEY = [...ACCOUNT, 'particulars', 'harbour'];
const APPOINTMENTS_KEY = ['company-appointments', 'profile-one', 'account-one'];
const COPY = REGISTER_PARTICULARS_COPY;
const DIGEST = 'a'.repeat(64);
const KEY = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const NEXT = 'https://example.test/tokens/register-particulars-changes/?page=2';
const LISTED = { uuid: 'ordinary', companyUuid: 'harbour', companyName: 'Harbour Example Pty Ltd' };
const MEMBER_ADA = '10000000-0000-4000-8000-0000000000aa';
const MEMBER_UNNAMED = '10000000-0000-4000-8000-0000000000bb';
const MEMBER_GONE = '10000000-0000-4000-8000-0000000000cc';
const PREPARED = '2026-10-05T01:00:00Z';
const CONTEXT = `change for Ada Member prepared ${formatDateTime(PREPARED)}`;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-/;
let client: QueryClient;
let appointments: OwnCompanyAppointment[];
let changePages: Paged<RegisterParticularsChange>[];
let previewFor: () => RegisterParticularsChangeDecisionPreview;
let decideFor: (body: RegisterParticularsChangeDecideRequest) => Promise<{ data: RegisterParticularsChange }>;

type Paged<T> = { data: { results: T[]; count: number; next: string | null; previous: null } };
type ReadConfig = { params?: { page?: number; company?: string } };

const REGISTERED: TokenHoldersResponse = {
  token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'deployed', totalSupply: '100' },
  initialized: true,
  issuedSupply: '30',
  waitingEffects: 0,
  holders: [
    {
      member: MEMBER_ADA,
      name: 'Ada Member',
      holderType: 'member',
      balance: '20',
      shareClass: 'ORD',
      source: 'register',
      identitySource: 'particulars',
      enteredOn: '2026-09-20',
      percentage: 66.67,
      wallets: [],
    },
    {
      member: MEMBER_UNNAMED,
      name: null,
      holderType: 'unidentified',
      balance: '10',
      shareClass: 'ORD',
      source: 'register',
      identitySource: 'none',
      enteredOn: '2026-09-20',
      percentage: 33.33,
      wallets: [],
    },
  ],
  totalHolders: 2,
  formerMembers: [],
  formerMembersAsAt: null,
  formerMembersBlock: null,
  formerMembersStale: false,
};

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

function change(overrides: Partial<RegisterParticularsChange> = {}): RegisterParticularsChange {
  return {
    uuid: 'change-ada',
    company: 'harbour',
    member: MEMBER_ADA,
    name: 'Ada Renamed',
    residentialAddress: '8 Synthetic Street, Melbourne VIC 3000',
    asAt: '2026-09-20',
    reason: 'Deed poll and a new address',
    evidenceFingerprint: 'f'.repeat(64),
    evidenceSnapshot: { name: 'deed-poll.pdf', mimeType: 'application/pdf' },
    supportingEvidence: 'evidence-supporting',
    preparingAppointment: 'appointment-a',
    preparedByName: 'Example Preparer',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    createdAt: PREPARED,
    ...overrides,
  };
}

function preview(overrides: Partial<RegisterParticularsChangeDecisionPreview> = {}) {
  return {
    previewDigest: DIGEST,
    unmetRequirements: [],
    canDecide: true,
    member: MEMBER_ADA,
    name: 'Ada Renamed',
    residentialAddress: '8 Synthetic Street, Melbourne VIC 3000',
    asAt: '2026-09-20',
    current: {
      name: 'Ada Member',
      residentialAddress: '1 Example Street, Sydney NSW 2000',
      asAt: '2026-09-01',
      sourceImport: 'import-one',
      sourceChange: null,
      sourceGrant: null,
    },
    ...overrides,
  };
}

function decided(request: RegisterParticularsChangeDecideRequest, base = change()): RegisterParticularsChange {
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
      ? { status: 'applied' as const, stage: 'applied', reviewedAt: decision.decidedAt }
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
    if (url === HOLDERS) return { data: REGISTERED };
    if (url === APPOINTMENTS) return page(appointments);
    if (url === PARTICULARS) return changePages[(config?.params?.page ?? 1) - 1];
    if (url === FILE) return { data: new Blob(['%PDF synthetic'], { type: 'application/pdf' }) };
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_LINK_WAITING_WALLETS) return { data: { wallets: [] } };
    if (url === ENTRIES || url.startsWith('/api/v1/tokens/register-')) return page([]);
    throw new Error(`Unexpected read ${url} ${JSON.stringify(config)}`);
  });
}

function switchAccount() {
  const other = companyPreferences('company');
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { ...other, userProfile: 'profile-two', userAccount: { ...other.userAccount!, uuid: 'account-two' } },
  });
}

function show() {
  prepareCompanyClient(client, 'company');
  client.setQueryData(['userAccount'], { data: { role: 'company' } });
  renderCompanyPage(client, <CompanyRegisterPage />, 'Register');
}

async function changes() {
  const heading = await screen.findByRole('heading', { level: 2, name: COPY.TITLE });
  const element = heading.parentElement!;
  await waitFor(() => expect(within(element).queryByRole('status')).toBeNull());
  return element;
}

async function members() {
  fireEvent.click(await screen.findByRole('button', { name: /Ordinary shares/ }));
  return (await screen.findByRole('heading', { level: 3, name: /Current members/ })).nextElementSibling as HTMLElement;
}

function records(element: HTMLElement) {
  return [...element.querySelectorAll(':scope > ul > li')] as HTMLElement[];
}

function rowText(element: HTMLElement, label: string) {
  return within(element).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
}

function block(element: HTMLElement, title: string) {
  const held = within(element).getByText(title).parentElement!;
  return [COPY.NAME, COPY.RESIDENTIAL_ADDRESS, COPY.AS_AT].map((label) => rowText(held, label));
}

function decisionLabels(record: HTMLElement) {
  return within(record)
    .queryAllByRole('button', { name: /^(Approve|Apply|Reject) \(/ })
    .map((button) => button.textContent?.split(' (')[0]);
}

function changeLinks() {
  return screen.queryAllByRole('link', { name: new RegExp(`^${COPY.PREPARE}`) });
}

async function openDecision(record: HTMLElement, kind: RegisterDecisionKind) {
  fireEvent.click(within(record).getByRole('button', { name: new RegExp(`^${COPY.DECISIONS[kind]} \\(`) }));
  const dialog = await screen.findByRole('dialog', { name: `${COPY.DECISIONS[kind]} particulars change` });
  await within(dialog).findByText(COPY.CURRENT_PARTICULARS);
  return dialog;
}

function confirmButton(dialog: HTMLElement, kind: RegisterDecisionKind) {
  return within(dialog).getByRole('button', {
    name: `${COPY.DECISIONS[kind]} particulars change`,
  }) as HTMLButtonElement;
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

function refreshCounts() {
  return [reads(PARTICULARS), reads(HOLDERS), reads(ENTRIES), reads(APPOINTMENTS)];
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let keys = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => KEY(++keys) as ReturnType<typeof crypto.randomUUID>);
  appointments = [appointment(['admin'])];
  changePages = [page([change()])];
  previewFor = () => preview();
  decideFor = async (body) => ({ data: decided(body) });
  serve();
  api.post.mockImplementation(async (url: string, body: RegisterParticularsChangeDecideRequest) => {
    if (url === PREVIEW) return { data: previewFor() };
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

it("lists every page of the company's changes newest first and each once, naming members only from the register", async () => {
  const approval = {
    uuid: 'decision-approve',
    kind: 'approve' as const,
    decidedBy: 2,
    decidedByName: 'Example Approver',
    appointment: 'appointment-b',
    idempotencyKey: KEY(90),
    digest: DIGEST,
    reason: '',
    decidedAt: '2026-10-03T03:00:00Z',
  };
  const rejected = change({
    uuid: 'change-unnamed',
    member: MEMBER_UNNAMED,
    status: 'rejected',
    stage: 'rejected',
    rejectionReason: 'The deed poll names someone else',
    reviewedAt: '2026-10-04T05:00:00Z',
    decisions: [{ ...approval, uuid: 'decision-reject', kind: 'reject', reason: 'The deed poll names someone else' }],
    createdAt: '2026-10-04T01:00:00Z',
  });
  const applied = change({
    uuid: 'change-gone',
    member: MEMBER_GONE,
    status: 'applied',
    stage: 'applied',
    reviewedAt: '2026-10-03T04:00:00Z',
    decisions: [{ ...approval, uuid: 'decision-apply', kind: 'apply', decidedAt: '2026-10-03T04:00:00Z' }, approval],
    createdAt: '2026-10-02T01:00:00Z',
  });
  changePages = [page([applied, change()], NEXT), page([change(), rejected])];
  show();
  const list = await changes();
  expect(api.get).toHaveBeenCalledWith(PARTICULARS, {
    params: { company: 'harbour', page: 1 },
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(api.get).toHaveBeenCalledWith(PARTICULARS, {
    params: { company: 'harbour', page: 2 },
    ledovaSubmissionGuard: expect.any(Function),
  });
  const [ada, unnamed, gone] = records(list);
  expect(records(list)).toHaveLength(3);
  expect([ada, unnamed, gone].map((record) => rowText(record, COPY.MEMBER))).toEqual([
    'Ada Member',
    COPY.UNNAMED_MEMBER,
    COPY.UNNAMED_MEMBER,
  ]);
  expect([ada, unnamed, gone].map((record) => rowText(record, 'Stage'))).toEqual([
    COPY.STAGES.submitted,
    COPY.STAGES.rejected,
    COPY.STAGES.applied,
  ]);
  expect(block(ada, COPY.PROPOSED_PARTICULARS)).toEqual([
    'Ada Renamed',
    '8 Synthetic Street, Melbourne VIC 3000',
    '2026-09-20',
  ]);
  expect(rowText(ada, COPY.REASON)).toBe('Deed poll and a new address');
  expect(rowText(ada, 'Prepared by')).toBe('Example Preparer');
  expect(rowText(unnamed, 'Rejection reason')).toBe('The deed poll names someone else');
  expect(rowText(gone, COPY.DECISIONS.approve)).toBe(`Example Approver · ${formatDateTime('2026-10-03T03:00:00Z')}`);
  expect(rowText(gone, COPY.DECISIONS.apply)).toBe(`Example Approver · ${formatDateTime('2026-10-03T04:00:00Z')}`);
  expect(within(list).getAllByText(COPY.PROVIDED_BY_COMPANY)).toHaveLength(3);
  expect(
    within(ada)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual([`${COPY.DOWNLOAD} (${CONTEXT})`, `Approve (${CONTEXT})`, `Apply (${CONTEXT})`, `Reject (${CONTEXT})`]);
  expect(within(list).queryAllByText(UUID)).toEqual([]);
});

it('refuses changes naming another company, showing none of them, and offers a retry', async () => {
  changePages = [page([change(), change({ uuid: 'change-inland', company: 'inland' })])];
  show();
  const list = await changes();
  expect(within(list).getByRole('alert')).toBeTruthy();
  expect(records(list)).toEqual([]);
  changePages = [page([change()])];
  fireEvent.click(within(list).getByRole('button', { name: /^Retry/ }));
  await waitFor(() => expect(records(list)).toHaveLength(1));
});

it('downloads the supporting document under its retained name, or a named fallback', async () => {
  const saved = stubDownloads();
  changePages = [
    page([change(), change({ uuid: 'change-bare', evidenceSnapshot: {}, createdAt: '2026-10-01T00:00:00Z' })]),
  ];
  serve((url) => (url.endsWith('/file/') ? { data: new Blob(['%PDF synthetic']) } : undefined));
  show();
  const [named, bare] = records(await changes());
  fireEvent.click(within(named).getByRole('button', { name: new RegExp(`^${COPY.DOWNLOAD}`) }));
  await waitFor(() => expect(saved).toEqual(['deed-poll.pdf']));
  fireEvent.click(within(bare).getByRole('button', { name: new RegExp(`^${COPY.DOWNLOAD}`) }));
  await waitFor(() => expect(saved).toEqual(['deed-poll.pdf', 'particulars-change-change-bare']));
  expect(api.get).toHaveBeenCalledWith(FILE, { ledovaSubmissionGuard: expect.any(Function), responseType: 'blob' });
});

it.each([
  [['admin'], ['Approve', 'Apply', 'Reject'], true, false],
  [['prepare'], [], true, false],
  [['approve'], ['Approve', 'Reject'], false, false],
  [['apply'], ['Apply'], false, false],
  [['read_register'], [], false, true],
] as const)(
  'offers an appointment holding %j the steps %j, Change particulars: %s, and the read-only note: %s',
  async (capabilities, steps, change, readOnly) => {
    appointments = [appointment([...capabilities])];
    show();
    const list = await changes();
    await waitFor(() => expect(decisionLabels(records(list)[0])).toEqual(steps));
    expect(!!within(list).queryByText(COPY.READ_ONLY_NOTE)).toBe(readOnly);
    const rows = await members();
    await waitFor(() => expect(changeLinks().length).toBe(change ? 2 : 0));
    if (change) {
      expect(changeLinks().map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
        [`${COPY.PREPARE} (Ada Member)`, DESTINATIONS.companyRegisterParticulars.path.replace(':member', MEMBER_ADA)],
        [
          `${COPY.PREPARE} (${HOLDER_TYPE_LABELS.unidentified})`,
          DESTINATIONS.companyRegisterParticulars.path.replace(':member', MEMBER_UNNAMED),
        ],
      ]);
      expect(within(rows).getAllByRole('link')).toHaveLength(2);
    }
  },
);

it('previews an approval with the current particulars beside the proposal, records exactly it and refreshes', async () => {
  show();
  const list = await changes();
  await members();
  await waitFor(() => expect(reads(ENTRIES)).toBe(1));
  const dialog = await openDecision(records(list)[0], 'approve');
  expect(writes(PREVIEW)).toEqual([
    [
      PREVIEW,
      { appointment: 'appointment-a', kind: 'approve', reason: '' },
      { ledovaSubmissionGuard: expect.any(Function) },
    ],
  ]);
  expect(within(dialog).getByText(COPY.CONFIRMATIONS.approve)).toBeTruthy();
  expect(within(dialog).getByText(COPY.PRECEDENCE_NOTE)).toBeTruthy();
  expect(block(dialog, COPY.CURRENT_PARTICULARS)).toEqual([
    'Ada Member',
    '1 Example Street, Sydney NSW 2000',
    '2026-09-01',
  ]);
  expect(block(dialog, COPY.PROPOSED_PARTICULARS)).toEqual([
    'Ada Renamed',
    '8 Synthetic Street, Melbourne VIC 3000',
    '2026-09-20',
  ]);
  const before = refreshCounts();
  const request = {
    appointment: 'appointment-a',
    kind: 'approve' as const,
    reason: '',
    idempotencyKey: KEY(1),
    previewDigest: DIGEST,
    confirmation: true,
  };
  changePages = [page([decided(request)])];
  fireEvent.click(confirmButton(dialog, 'approve'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(writes(DECIDE)).toEqual([[DECIDE, request, { ledovaSubmissionGuard: expect.any(Function) }]]);
  await waitFor(() => expect(refreshCounts()).toEqual(before.map((count) => count + 1)));
  expect(await within(list).findByText(COPY.STAGES.approved)).toBeTruthy();
  expect(rowText(list, COPY.DECISIONS.approve)).toBe(`Example Decider · ${formatDateTime('2026-10-05T02:00:00Z')}`);
});

it('says when the member has no particulars yet, and keeps a decision with unmet requirements unconfirmable', async () => {
  previewFor = () =>
    preview({ current: null, canDecide: false, unmetRequirements: ['member_left_retention', 'future_rule'] });
  show();
  const dialog = await openDecision(records(await changes())[0], 'apply');
  expect(within(dialog).getByText(COPY.NO_CURRENT_PARTICULARS)).toBeTruthy();
  expect(within(dialog).getByText(REGISTER_PARTICULARS_UNMET_COPY.member_left_retention)).toBeTruthy();
  expect(within(dialog).getByText('future_rule')).toBeTruthy();
  fireEvent.click(confirmButton(dialog, 'apply'));
  expect(confirmButton(dialog, 'apply').disabled).toBe(true);
  expect(writes(DECIDE)).toHaveLength(0);
});

it('words a refused decision by the requirements the server lacks and refreshes the changes, register and team', async () => {
  decideFor = async () => {
    throw { response: { status: 400, data: { unmetRequirements: ['approval_lapsed', 'newer_particulars_exist'] } } };
  };
  show();
  const list = await changes();
  await members();
  await waitFor(() => expect(reads(ENTRIES)).toBe(1));
  const dialog = await openDecision(records(list)[0], 'apply');
  const before = refreshCounts();
  fireEvent.click(confirmButton(dialog, 'apply'));
  expect((await within(dialog).findByRole('alert')).textContent).toBe(
    `${REGISTER_PARTICULARS_UNMET_COPY.approval_lapsed} ${REGISTER_PARTICULARS_UNMET_COPY.newer_particulars_exist}`,
  );
  await waitFor(() => expect(refreshCounts()).toEqual(before.map((count) => count + 1)));
});

it('holds a previewed decision and withdraws every step and Change particulars once the appointment is revoked', async () => {
  show();
  const list = await changes();
  await members();
  await waitFor(() => expect(changeLinks()).toHaveLength(2));
  const dialog = await openDecision(records(list)[0], 'approve');
  expect(confirmButton(dialog, 'approve').disabled).toBe(false);
  appointments = [appointment(['admin'], { status: 'revoked', isEffective: false, revokedAt: '2026-10-05T03:00:00Z' })];
  await act(async () => {
    await client.refetchQueries({ queryKey: APPOINTMENTS_KEY });
  });
  await waitFor(() => expect(confirmButton(dialog, 'approve').disabled).toBe(true));
  expect(within(dialog).getByText(STEP_CHANGED)).toBeTruthy();
  fireEvent.click(confirmButton(dialog, 'approve'));
  expect(writes(DECIDE)).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(decisionLabels(records(list)[0])).toEqual([]);
  expect(changeLinks()).toHaveLength(0);
  expect(within(list).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('withholds every step and Change particulars while the appointments cannot be read, and offers their retry', async () => {
  show();
  const list = await changes();
  await members();
  await waitFor(() => expect(changeLinks()).toHaveLength(2));
  serve((url) => (url === APPOINTMENTS ? Promise.reject(new Error('Unavailable')) : undefined));
  await act(async () => {
    await client.refetchQueries({ queryKey: APPOINTMENTS_KEY });
  });
  await waitFor(() => expect(decisionLabels(records(list)[0])).toEqual([]));
  expect(changeLinks()).toHaveLength(0);
  expect(within(list).queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
  serve();
  fireEvent.click(within(within(list).getByRole('alert')).getByRole('button'));
  await waitFor(() => expect(decisionLabels(records(list)[0])).toEqual(['Approve', 'Apply', 'Reject']));
  expect(changeLinks()).toHaveLength(2);
});

it.each([false, true])(
  'records and refreshes nothing when a decision returns after the signed-in account changed (refused: %s)',
  async (refused) => {
    const pending = deferred<void>();
    decideFor = async (body) => {
      await pending.promise;
      if (refused) throw { response: { status: 409, data: { detail: 'The register operation conflicts.' } } };
      return { data: decided(body) };
    };
    show();
    const dialog = await openDecision(records(await changes())[0], 'apply');
    fireEvent.click(confirmButton(dialog, 'apply'));
    await waitFor(() => expect(writes(DECIDE)).toHaveLength(1));
    act(switchAccount);
    await act(async () => pending.resolve());
    for (const queryKey of [PARTICULARS_KEY, [...ACCOUNT, 'holders', 'ordinary'], APPOINTMENTS_KEY])
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it('keeps no changes whose read returns after the signed-in account changed', async () => {
  const pending = deferred<Paged<RegisterParticularsChange>>();
  serve((url) => (url === PARTICULARS ? pending.promise : undefined));
  show();
  await waitFor(() => expect(reads(PARTICULARS)).toBe(1));
  act(switchAccount);
  await act(async () => pending.resolve(page([change()])));
  expect(client.getQueryData(PARTICULARS_KEY)).toBeUndefined();
});

it('saves no supporting document whose download returns after the signed-in account changed', async () => {
  const saved = stubDownloads();
  const pending = deferred<{ data: Blob }>();
  show();
  const [record] = records(await changes());
  serve((url) => (url === FILE ? pending.promise : undefined));
  fireEvent.click(within(record).getByRole('button', { name: new RegExp(`^${COPY.DOWNLOAD}`) }));
  await waitFor(() => expect(reads(FILE)).toBe(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: new Blob(['%PDF synthetic']) }));
  expect(saved).toEqual([]);
});

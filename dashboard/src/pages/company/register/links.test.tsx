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
  REGISTER_LINK_COPY,
  REGISTER_LINK_UNMET_COPY,
  USER_PREFERENCES_QUERY_KEY,
  formatDateTime,
  type CompanyCapability,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterLink,
  type RegisterLinkDecideRequest,
  type RegisterLinkDecisionPreview,
  type RegisterWaitingWallets,
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
const LINKS = COMPANY_TOKEN_ENDPOINTS.REGISTER_LINKS;
const WAITING = COMPANY_TOKEN_ENDPOINTS.REGISTER_LINK_WAITING_WALLETS;
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const PREVIEW = (uuid: string) => COMPANY_TOKEN_ENDPOINTS.REGISTER_LINK_PREVIEW(uuid);
const DECIDE = (uuid: string) => COMPANY_TOKEN_ENDPOINTS.REGISTER_LINK_DECIDE(uuid);
const FILE = COMPANY_TOKEN_ENDPOINTS.REGISTER_LINK_FILE('link-pending');
const ACCOUNT = ['tokens', 'register', 'profile-one', 'account-one'];
const LINKS_KEY = [...ACCOUNT, 'links', 'harbour'];
const WAITING_KEY = [...ACCOUNT, 'waiting-wallets', 'harbour'];
const APPOINTMENTS_KEY = ['company-appointments', 'profile-one', 'account-one'];
const COPY = REGISTER_LINK_COPY;
const DIGEST = 'a'.repeat(64);
const KEY = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const NEXT = 'https://example.test/tokens/register-links/?page=2';
const LISTED = { uuid: 'ordinary', companyUuid: 'harbour', companyName: 'Harbour Example Pty Ltd' };
const ADA_WALLET = `0x${'a'.repeat(40)}`;
const BO_WALLET = `0x${'b'.repeat(40)}`;
const CY_WALLET = `0x${'c'.repeat(40)}`;
const MEMBER_ADA = '10000000-0000-4000-8000-0000000000aa';
const MEMBER_NEW = '10000000-0000-4000-8000-0000000000bb';
const MEMBER_GONE = '10000000-0000-4000-8000-0000000000cc';
const PREPARED = '2026-10-05T01:00:00Z';
const CONTEXT = `wallet link prepared ${formatDateTime(PREPARED)}`;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-/;
let client: QueryClient;
let appointments: OwnCompanyAppointment[];
let linkPages: Paged<RegisterLink>[];
let waitingWallets: RegisterWaitingWallets['wallets'];
let decideFor: (body: RegisterLinkDecideRequest) => Promise<{ data: RegisterLink }>;

type Paged<T> = { data: { results: T[]; count: number; next: string | null; previous: null } };
type ReadConfig = { params?: { page?: number; company?: string } };

const REGISTERED: TokenHoldersResponse = {
  token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'deployed', totalSupply: '100' },
  initialized: true,
  issuedSupply: '20',
  waitingEffects: 2,
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
      percentage: 100,
      wallets: [],
    },
  ],
  totalHolders: 1,
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

function link(overrides: Partial<RegisterLink> = {}): RegisterLink {
  return {
    uuid: 'link-pending',
    company: 'harbour',
    mapping: [
      { address: ADA_WALLET, member: MEMBER_ADA },
      { address: BO_WALLET, member: MEMBER_NEW },
      { address: CY_WALLET, member: MEMBER_GONE },
    ],
    mappingSummary: [
      { address: ADA_WALLET, member: MEMBER_ADA, memberExists: true },
      { address: BO_WALLET, member: MEMBER_NEW, memberExists: false },
      { address: CY_WALLET, member: MEMBER_GONE, memberExists: true },
    ],
    authority: 'director_resolution',
    approvingDirector: 'Example Director',
    authorityReference: 'RESOLUTION-LINK-1',
    reason: 'Link the wallets of the September subscribers',
    sourceDocument: null,
    evidenceFingerprint: 'f'.repeat(64),
    evidenceSnapshot: { name: 'link-resolution.pdf', mimeType: 'application/pdf' },
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
    decisions: [],
    createdAt: PREPARED,
    ...overrides,
  };
}

const STAFF_ERA = link({
  uuid: 'link-staff',
  mapping: [{ address: CY_WALLET, member: MEMBER_ADA }],
  mappingSummary: [{ address: CY_WALLET, member: MEMBER_ADA, memberExists: true }],
  sourceDocument: 'document-verified',
  authorityEvidence: null,
  preparingAppointment: null,
  preparedByName: null,
  providedBy: 'staff_verified',
  evidenceSnapshot: {},
  createdAt: '2026-09-30T01:00:00Z',
});

function preview(): RegisterLinkDecisionPreview {
  return {
    previewDigest: DIGEST,
    unmetRequirements: [],
    canDecide: true,
    links: [
      {
        address: ADA_WALLET,
        member: MEMBER_ADA,
        memberExists: true,
        walletProof: 'proven',
        holderType: 'member',
        holderName: 'Ada Member',
      },
      {
        address: BO_WALLET,
        member: MEMBER_NEW,
        memberExists: false,
        walletProof: 'not_proven',
        holderType: 'unidentified',
        holderName: null,
      },
      {
        address: CY_WALLET,
        member: MEMBER_GONE,
        memberExists: true,
        walletProof: null,
        holderType: null,
        holderName: null,
      },
    ],
  };
}

function decided(request: RegisterLinkDecideRequest, base = link()): RegisterLink {
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
    if (url === LINKS) return linkPages[(config?.params?.page ?? 1) - 1];
    if (url === WAITING) return { data: { wallets: waitingWallets } };
    if (url === FILE) return { data: new Blob(['%PDF synthetic'], { type: 'application/pdf' }) };
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

async function section() {
  const heading = await screen.findByRole('heading', { level: 2, name: COPY.TITLE });
  const element = heading.parentElement!;
  await waitFor(() => expect(within(element).queryByRole('status')).toBeNull());
  return element;
}

async function stepsRead() {
  await waitFor(() => expect(client.getQueryState(APPOINTMENTS_KEY)?.status).toBe('success'));
}

function records(element: HTMLElement) {
  return [...element.querySelectorAll(':scope > ul > li')] as HTMLElement[];
}

function rowText(element: HTMLElement, label: string) {
  return within(element).getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;
}

function rows(element: HTMLElement, heading: string) {
  const list = within(element).getByText(heading).nextElementSibling as HTMLElement;
  return [...list.querySelectorAll(':scope > li')].map((item) => [...item.children].map((child) => child.textContent));
}

function decisionLabels(record: HTMLElement) {
  return within(record)
    .queryAllByRole('button', { name: /^(Approve|Apply|Reject) \(/ })
    .map((button) => button.textContent?.split(' (')[0]);
}

function prepareLinks() {
  return screen.queryAllByRole('link', { name: COPY.PREPARE });
}

async function openDecision(record: HTMLElement, kind: RegisterDecisionKind) {
  fireEvent.click(within(record).getByRole('button', { name: new RegExp(`^${COPY.DECISIONS[kind]} \\(`) }));
  const dialog = await screen.findByRole('dialog', { name: `${COPY.DECISIONS[kind]} wallet link` });
  await within(dialog).findByText(COPY.STATUS_NOTE);
  return dialog;
}

function confirmButton(dialog: HTMLElement, kind: RegisterDecisionKind) {
  return within(dialog).getByRole('button', { name: `${COPY.DECISIONS[kind]} wallet link` }) as HTMLButtonElement;
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
  return [reads(LINKS), reads(WAITING), reads(HOLDERS), reads(ENTRIES), reads(APPOINTMENTS)];
}

async function openClass() {
  fireEvent.click(await screen.findByRole('button', { name: /Ordinary shares/ }));
  await waitFor(() => expect(reads(ENTRIES)).toBe(1));
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let keys = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => KEY(++keys) as ReturnType<typeof crypto.randomUUID>);
  appointments = [appointment(['admin'])];
  linkPages = [page([link()])];
  waitingWallets = [{ address: BO_WALLET, waiting: 1, walletProof: null, holderType: null, holderName: null }];
  decideFor = async (body) => ({ data: decided(body) });
  serve();
  api.post.mockImplementation(async (url: string, body: RegisterLinkDecideRequest) => {
    if (url.endsWith('/decision-preview/')) return { data: preview() };
    if (url.endsWith('/decide/')) return decideFor(body);
    throw new Error(`Unexpected write ${url}`);
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("lists every page of the company's links newest first and each once, with each wallet's member and provenance", async () => {
  const rejected = link({
    uuid: 'link-rejected',
    authority: 'court_order',
    approvingDirector: '',
    status: 'rejected',
    stage: 'rejected',
    rejectionReason: 'The resolution names another wallet',
    reviewedAt: '2026-10-04T05:00:00Z',
    decisions: [
      {
        uuid: 'decision-reject',
        kind: 'reject',
        decidedBy: 2,
        decidedByName: 'Example Approver',
        appointment: 'appointment-b',
        idempotencyKey: KEY(90),
        digest: DIGEST,
        reason: 'The resolution names another wallet',
        decidedAt: '2026-10-04T05:00:00Z',
      },
    ],
    createdAt: '2026-10-04T01:00:00Z',
  });
  linkPages = [page([STAFF_ERA, link()], NEXT), page([link(), rejected])];
  show();
  const list = await section();
  for (const index of [1, 2])
    expect(api.get).toHaveBeenCalledWith(LINKS, {
      params: { company: 'harbour', page: index },
      ledovaSubmissionGuard: expect.any(Function),
    });
  const [pending, refused, staff] = records(list);
  expect(records(list)).toHaveLength(3);
  expect([pending, refused, staff].map((record) => rowText(record, 'Stage'))).toEqual([
    COPY.STAGES.submitted,
    COPY.STAGES.rejected,
    COPY.STAGES.submitted,
  ]);
  expect(rows(pending, COPY.WALLETS)).toEqual([
    ['Ada Member', ADA_WALLET],
    [COPY.NEW_MEMBER, BO_WALLET],
    [COPY.EXISTING_MEMBER, CY_WALLET],
  ]);
  expect(
    [COPY.AUTHORITY, COPY.APPROVING_DIRECTOR, COPY.AUTHORITY_REFERENCE, COPY.REASON, 'Prepared by'].map((label) =>
      rowText(pending, label),
    ),
  ).toEqual([
    COPY.AUTHORITIES.director_resolution,
    'Example Director',
    'RESOLUTION-LINK-1',
    'Link the wallets of the September subscribers',
    'Example Preparer',
  ]);
  expect(rowText(refused, COPY.AUTHORITY)).toBe(COPY.AUTHORITIES.court_order);
  expect(within(refused).queryByText(COPY.APPROVING_DIRECTOR)).toBeNull();
  expect(rowText(refused, COPY.DECISIONS.reject)).toBe(
    `Example Approver · ${formatDateTime('2026-10-04T05:00:00Z')} · The resolution names another wallet`,
  );
  expect(rowText(refused, 'Rejection reason')).toBe('The resolution names another wallet');
  expect([pending, refused, staff].map((record) => !!within(record).queryByText(COPY.PROVIDED_BY_COMPANY))).toEqual([
    true,
    true,
    false,
  ]);
  expect(within(staff).getByText(COPY.STAFF_VERIFIED)).toBeTruthy();
  expect(within(staff).queryByText('Prepared by')).toBeNull();
  await stepsRead();
  expect(
    within(pending)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual([`${COPY.DOWNLOAD} (${CONTEXT})`, `Approve (${CONTEXT})`, `Apply (${CONTEXT})`, `Reject (${CONTEXT})`]);
  expect(decisionLabels(staff)).toEqual(['Reject']);
  expect(decisionLabels(refused)).toEqual([]);
  expect(within(list).queryAllByText(UUID)).toEqual([]);
});

it('refuses links naming another company, showing none of them, and offers a retry', async () => {
  linkPages = [page([link(), link({ uuid: 'link-inland', company: 'inland' })])];
  show();
  const list = await section();
  expect(within(list).getByRole('alert').textContent).toContain('wallet links');
  expect(records(list)).toEqual([]);
  linkPages = [page([link()])];
  fireEvent.click(within(list).getByRole('button', { name: 'Retry wallet links' }));
  await waitFor(() => expect(records(list)).toHaveLength(1));
});

it.each([
  [['admin'], ['Approve', 'Apply', 'Reject'], true, false],
  [['prepare'], [], true, false],
  [['approve'], ['Approve', 'Reject'], false, false],
  [['apply'], ['Apply'], false, false],
  [['read_register'], [], false, true],
] as const)(
  'offers an appointment holding %j the steps %j, Link waiting wallets: %s, and the read-only note: %s',
  async (capabilities, steps, prepare, readOnly) => {
    appointments = [appointment([...capabilities])];
    show();
    const list = await section();
    await stepsRead();
    expect(decisionLabels(records(list)[0])).toEqual(steps);
    expect(!!within(list).queryByText(COPY.READ_ONLY_NOTE)).toBe(readOnly);
    if (prepare)
      expect((await within(list).findByRole('link', { name: COPY.PREPARE })).getAttribute('href')).toBe(
        DESTINATIONS.companyRegisterLinks.path.replace(':company', 'harbour'),
      );
    expect(prepareLinks()).toHaveLength(prepare ? 1 : 0);
    expect(api.get.mock.calls.filter(([url]) => url === WAITING)).toEqual(
      prepare ? [[WAITING, { params: { company: 'harbour' }, ledovaSubmissionGuard: expect.any(Function) }]] : [],
    );
  },
);

it('says nothing waits instead of offering Link waiting wallets when no wallet waits', async () => {
  waitingWallets = [];
  show();
  const list = await section();
  expect(await within(list).findByText(COPY.NOTHING_WAITING)).toBeTruthy();
  expect(prepareLinks()).toHaveLength(0);
});

it("previews an application with each wallet's member and its holder's own proof, records it and refreshes", async () => {
  show();
  const list = await section();
  await openClass();
  await waitFor(() => expect(reads(WAITING)).toBe(1));
  const dialog = await openDecision(records(list)[0], 'apply');
  expect(writes(PREVIEW('link-pending'))).toEqual([
    [
      PREVIEW('link-pending'),
      { appointment: 'appointment-a', kind: 'apply', reason: '' },
      { ledovaSubmissionGuard: expect.any(Function) },
    ],
  ]);
  expect(within(dialog).getByText(COPY.CONFIRMATIONS.apply)).toBeTruthy();
  expect(within(dialog).getByText(COPY.APPLY_NOTE)).toBeTruthy();
  expect(rows(dialog, COPY.STATUS_NOTE)).toEqual([
    ['Ada Member', ADA_WALLET, COPY.WALLET_PROOF.proven, `${COPY.HOLDER}: Ada Member`],
    [COPY.NEW_MEMBER, BO_WALLET, COPY.WALLET_PROOF.not_proven, `${COPY.HOLDER}: ${HOLDER_TYPE_LABELS.unidentified}`],
    [COPY.EXISTING_MEMBER, CY_WALLET, COPY.NO_STATUS],
  ]);
  expect(within(dialog).queryByText(/verified/i)).toBeNull();
  const before = refreshCounts();
  const request = {
    appointment: 'appointment-a',
    kind: 'apply' as const,
    reason: '',
    idempotencyKey: KEY(1),
    previewDigest: DIGEST,
    confirmation: true,
  };
  linkPages = [page([decided(request)])];
  fireEvent.click(confirmButton(dialog, 'apply'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(writes(DECIDE('link-pending'))).toEqual([
    [DECIDE('link-pending'), request, { ledovaSubmissionGuard: expect.any(Function) }],
  ]);
  await waitFor(() => expect(refreshCounts()).toEqual(before.map((count) => count + 1)));
  expect(await within(list).findByText(COPY.STAGES.applied)).toBeTruthy();
});

it('offers a staff-era link only rejection, with a reason of at most 1,000 characters, and records that reason', async () => {
  linkPages = [page([STAFF_ERA])];
  decideFor = async (body) => ({ data: decided(body, STAFF_ERA) });
  show();
  const list = await section();
  await stepsRead();
  expect(decisionLabels(records(list)[0])).toEqual(['Reject']);
  const dialog = await openDecision(records(list)[0], 'reject');
  const reason = within(dialog).getByLabelText(COPY.REJECTION_REASON) as HTMLTextAreaElement;
  expect(reason.maxLength).toBe(1000);
  fireEvent.change(reason, { target: { value: '  Prepare a company-run link instead  ' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Preview the rejection' }));
  await waitFor(() => expect(writes(PREVIEW('link-staff'))).toHaveLength(2));
  await waitFor(() => expect(confirmButton(dialog, 'reject').disabled).toBe(false));
  fireEvent.click(confirmButton(dialog, 'reject'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(writes(DECIDE('link-staff')).map(([, body]) => body)).toEqual([
    {
      appointment: 'appointment-a',
      kind: 'reject',
      reason: 'Prepare a company-run link instead',
      idempotencyKey: KEY(2),
      previewDigest: DIGEST,
      confirmation: true,
    },
  ]);
});

it('words a refused decision by the requirements the server lacks and refreshes the same reads', async () => {
  decideFor = async () => {
    throw { response: { status: 400, data: { unmetRequirements: ['wallet_linked_elsewhere', 'approval_lapsed'] } } };
  };
  show();
  const list = await section();
  await openClass();
  await waitFor(() => expect(reads(WAITING)).toBe(1));
  const dialog = await openDecision(records(list)[0], 'apply');
  const before = refreshCounts();
  fireEvent.click(confirmButton(dialog, 'apply'));
  expect((await within(dialog).findByRole('alert')).textContent).toBe(
    `${REGISTER_LINK_UNMET_COPY.wallet_linked_elsewhere} ${REGISTER_LINK_UNMET_COPY.approval_lapsed}`,
  );
  await waitFor(() => expect(refreshCounts()).toEqual(before.map((count) => count + 1)));
});

it('holds a previewed decision and withdraws every step and Link waiting wallets once the appointment is revoked', async () => {
  show();
  const list = await section();
  expect(await within(list).findByRole('link', { name: COPY.PREPARE })).toBeTruthy();
  const dialog = await openDecision(records(list)[0], 'approve');
  expect(confirmButton(dialog, 'approve').disabled).toBe(false);
  appointments = [appointment(['admin'], { status: 'revoked', isEffective: false, revokedAt: '2026-10-05T03:00:00Z' })];
  await act(async () => {
    await client.refetchQueries({ queryKey: APPOINTMENTS_KEY });
  });
  await waitFor(() => expect(confirmButton(dialog, 'approve').disabled).toBe(true));
  expect(within(dialog).getByText(STEP_CHANGED)).toBeTruthy();
  fireEvent.click(confirmButton(dialog, 'approve'));
  expect(writes(DECIDE('link-pending'))).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(decisionLabels(records(list)[0])).toEqual([]);
  expect(prepareLinks()).toHaveLength(0);
  expect(within(list).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('withholds every step and Link waiting wallets while the appointments cannot be read, and offers their retry', async () => {
  show();
  const list = await section();
  expect(await within(list).findByRole('link', { name: COPY.PREPARE })).toBeTruthy();
  serve((url) => (url === APPOINTMENTS ? Promise.reject(new Error('Unavailable')) : undefined));
  await act(async () => {
    await client.refetchQueries({ queryKey: APPOINTMENTS_KEY });
  });
  await waitFor(() => expect(decisionLabels(records(list)[0])).toEqual([]));
  expect(prepareLinks()).toHaveLength(0);
  expect(within(list).queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
  serve();
  fireEvent.click(within(list).getByRole('button', { name: 'Retry appointments' }));
  await waitFor(() => expect(decisionLabels(records(list)[0])).toEqual(['Approve', 'Apply', 'Reject']));
  expect(prepareLinks()).toHaveLength(1);
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
    const dialog = await openDecision(records(await section())[0], 'apply');
    fireEvent.click(confirmButton(dialog, 'apply'));
    await waitFor(() => expect(writes(DECIDE('link-pending'))).toHaveLength(1));
    act(switchAccount);
    await act(async () => pending.resolve());
    for (const queryKey of [LINKS_KEY, WAITING_KEY, [...ACCOUNT, 'holders', 'ordinary'], APPOINTMENTS_KEY])
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it.each([
  ['links', LINKS, LINKS_KEY, () => page([link()])],
  ['waiting wallets', WAITING, WAITING_KEY, () => ({ data: { wallets: waitingWallets } })],
])('keeps no %s whose read returns after the signed-in account changed', async (_what, url, queryKey, answer) => {
  const pending = deferred<unknown>();
  serve((called) => (called === url ? pending.promise : undefined));
  show();
  await waitFor(() => expect(reads(url)).toBe(1));
  act(switchAccount);
  await act(async () => pending.resolve(answer()));
  expect(client.getQueryData(queryKey)).toBeUndefined();
});

it('downloads the authority document under its retained name, or a named fallback', async () => {
  const saved = stubDownloads();
  linkPages = [page([link(), STAFF_ERA])];
  serve((url) => (url.endsWith('/file/') ? { data: new Blob(['%PDF synthetic']) } : undefined));
  show();
  const [named, bare] = records(await section());
  fireEvent.click(within(named).getByRole('button', { name: new RegExp(`^${COPY.DOWNLOAD}`) }));
  await waitFor(() => expect(saved).toEqual(['link-resolution.pdf']));
  fireEvent.click(within(bare).getByRole('button', { name: new RegExp(`^${COPY.DOWNLOAD}`) }));
  await waitFor(() => expect(saved).toEqual(['link-resolution.pdf', 'wallet-link-link-staff']));
  expect(api.get).toHaveBeenCalledWith(FILE, { ledovaSubmissionGuard: expect.any(Function), responseType: 'blob' });
});

it('saves no authority document whose download returns after the signed-in account changed', async () => {
  const saved = stubDownloads();
  const pending = deferred<{ data: Blob }>();
  show();
  const [record] = records(await section());
  serve((url) => (url === FILE ? pending.promise : undefined));
  fireEvent.click(within(record).getByRole('button', { name: new RegExp(`^${COPY.DOWNLOAD}`) }));
  await waitFor(() => expect(reads(FILE)).toBe(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: new Blob(['%PDF synthetic']) }));
  expect(saved).toEqual([]);
});

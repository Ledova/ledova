// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  COMPANY_TOKEN_ENDPOINTS,
  REGISTER_IMPORT_COPY,
  REGISTER_IMPORT_UNMET_COPY,
  USER_PREFERENCES_QUERY_KEY,
  formatDateTime,
  type AccountRole,
  type CompanyCapability,
  type OwnCompanyAppointment,
  type RegisterImport,
  type RegisterImportDecideRequest,
  type RegisterImportDecisionKind,
  type RegisterImportDecisionPreview,
  type TokenHoldersResponse,
} from '@ledova/shared';
import CompanyRegisterPage from '.';
import { companyPreferences, prepareCompanyClient, renderCompanyPage } from '../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

const REGISTER = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const HOLDERS = COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary');
const IMPORTS = COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORTS;
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const PREVIEW = COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_PREVIEW('import-new');
const DECIDE = COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_DECIDE('import-new');
const DIGEST = 'a'.repeat(64);
const COPY = REGISTER_IMPORT_COPY;
const WALLET = `0x${'1'.repeat(40)}`;
const KEY = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
let client: QueryClient;
let imports: RegisterImport[];
let appointments: OwnCompanyAppointment[];
let previewFor: (body: { kind: RegisterImportDecisionKind; reason: string }) => RegisterImportDecisionPreview;
let decideFor: (body: RegisterImportDecideRequest) => Promise<{ data: RegisterImport }>;

function holders(): TokenHoldersResponse {
  return {
    token: {
      uuid: 'ordinary',
      name: 'Ordinary shares',
      symbol: 'ORD',
      status: 'deployed',
      totalSupply: '9007199254740999',
    },
    initialized: true,
    issuedSupply: '9007199254740993',
    waitingEffects: 0,
    holders: [
      {
        member: 'member-one',
        name: 'Example Member',
        holderType: 'member',
        balance: '9007199254740993',
        shareClass: 'ORD',
        source: 'register',
        identitySource: 'stamp',
        enteredOn: '2026-09-01',
        percentage: 100,
        wallets: [{ address: WALLET, whitelistStatus: 'Active' }],
      },
    ],
    totalHolders: 1,
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

function proposal(overrides: Partial<RegisterImport> = {}): RegisterImport {
  return {
    uuid: 'import-new',
    company: 'harbour',
    token: 'ordinary',
    asAt: '2026-09-20',
    members: [
      {
        name: 'Example Member',
        member: 'member-one',
        shares: '9007199254740993',
        enteredOn: '2019-05-01',
        amountPaid: '250.00',
        residentialAddress: '1 Example Street, Sydney NSW 2000',
      },
    ],
    formerMembers: [],
    authority: 'director_resolution',
    approvingDirector: 'Example Director',
    authorityReference: 'RESOLUTION-IMPORT-1',
    reason: "Import the company's register",
    sourceDocument: null,
    evidenceFingerprint: 'b'.repeat(64),
    evidenceSnapshot: { providedBy: 'company', name: 'members-register.pdf', mimeType: 'application/pdf' },
    asicDocument: null,
    asicFingerprint: 'c'.repeat(64),
    asicSnapshot: { providedBy: 'company', name: 'asic-extract.pdf', mimeType: 'application/pdf' },
    registerEvidence: 'evidence-register',
    asicEvidence: 'evidence-asic',
    preparingAppointment: 'appointment-a',
    preparedByName: 'Example Preparer',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    asicIssuedTotal: '9007199254740993',
    asicMemberCount: 1,
    registerSequence: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    createdAt: '2026-10-05T01:00:00Z',
    ...overrides,
  };
}

function preview(overrides: Partial<RegisterImportDecisionPreview> = {}): RegisterImportDecisionPreview {
  return {
    previewDigest: DIGEST,
    unmetRequirements: [],
    canDecide: true,
    opensRegister: false,
    registerSequence: 3,
    comparison: [
      {
        member: 'member-one',
        name: 'Example Member',
        imported: '9007199254740993',
        stored: '9007199254740993',
        enteredOn: '2026-09-01',
        importedEnteredOn: '2019-05-01',
        wallets: [WALLET],
        liveName: 'Example Live Member',
        liveAddress: null,
      },
    ],
    statedTotal: '9007199254740993',
    statedMemberCount: 1,
    importedTotal: '9007199254740993',
    importedMemberCount: 1,
    ...overrides,
  };
}

function decided(request: RegisterImportDecideRequest, base = proposal()): RegisterImport {
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

function page<T>(results: T[], next: string | null = null) {
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
  const heading = await screen.findByRole('heading', { level: 3, name: COPY.TITLE });
  const section = heading.parentElement!;
  await waitFor(() => expect(within(section).queryByRole('status')).toBeNull());
  return section;
}

function records(section: HTMLElement) {
  return within(section).getAllByRole('listitem');
}

async function openDecision(record: HTMLElement, kind: RegisterImportDecisionKind) {
  fireEvent.click(within(record).getByRole('button', { name: COPY.DECISIONS[kind] }));
  return screen.findByRole('dialog', { name: `${COPY.DECISIONS[kind]} import` });
}

function confirmButton(dialog: HTMLElement, kind: RegisterImportDecisionKind) {
  return within(dialog).getByRole('button', { name: `${COPY.DECISIONS[kind]} import` }) as HTMLButtonElement;
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
  imports = [proposal()];
  appointments = [appointment(['admin'])];
  previewFor = () => preview();
  decideFor = async (body) => ({ data: decided(body) });
  api.get.mockImplementation(async (url: string, config?: { params?: { page?: number } }) => {
    if (url === REGISTER)
      return page([{ uuid: 'ordinary', companyUuid: 'harbour', companyName: 'Harbour Example Pty Ltd' }]);
    if (url === HOLDERS) return { data: holders() };
    if (url === IMPORTS) return page(imports);
    if (url === APPOINTMENTS) return page(appointments);
    if (url.endsWith('/file/') || url.endsWith('/asic-file/'))
      return { data: new Blob(['%PDF synthetic'], { type: 'application/pdf' }) };
    throw new Error(`Unexpected read ${url} ${JSON.stringify(config)}`);
  });
  api.post.mockImplementation(async (url: string, body: RegisterImportDecideRequest) => {
    if (url === PREVIEW) return { data: previewFor(body as { kind: RegisterImportDecisionKind; reason: string }) };
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

it('lists every page of the class imports newest first with their stage, preparer, figures, provenance and trail', async () => {
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
  const applied = proposal({
    uuid: 'import-applied',
    status: 'applied',
    stage: 'applied',
    createdAt: '2026-10-02T01:00:00Z',
    reviewedAt: application.decidedAt,
    decisions: [application, approval],
  });
  const retired = proposal({
    uuid: 'import-retired',
    status: 'rejected',
    stage: 'rejected',
    createdAt: '2026-09-30T01:00:00Z',
    providedBy: 'staff_verified',
    preparedByName: null,
    preparingAppointment: null,
    registerEvidence: null,
    asicEvidence: null,
    asicSnapshot: null,
    asicIssuedTotal: null,
    asicMemberCount: null,
    rejectionReason: 'Superseded by the company-run import',
  });
  api.get.mockImplementation(async (url: string, config?: { params?: { page?: number } }) => {
    if (url === REGISTER)
      return page([{ uuid: 'ordinary', companyUuid: 'harbour', companyName: 'Harbour Example Pty Ltd' }]);
    if (url === HOLDERS) return { data: holders() };
    if (url === APPOINTMENTS) return page([appointment(['read_register'])]);
    if (url === IMPORTS)
      return config?.params?.page === 2
        ? page([proposal()])
        : page([retired, applied], 'https://example.test/tokens/register-imports/?page=2');
    throw new Error(`Unexpected read ${url}`);
  });
  const section = await openClass();
  expect(api.get).toHaveBeenCalledWith(IMPORTS, {
    params: { token: 'ordinary', page: 1 },
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(api.get).toHaveBeenCalledWith(IMPORTS, {
    params: { token: 'ordinary', page: 2 },
    ledovaSubmissionGuard: expect.any(Function),
  });
  const [newest, middle, oldest] = records(section);
  expect(records(section)).toHaveLength(3);
  expect(within(newest).getByText(COPY.STAGES.submitted)).toBeTruthy();
  expect(within(middle).getByText(COPY.STAGES.applied)).toBeTruthy();
  expect(within(oldest).getByText(COPY.STAGES.rejected)).toBeTruthy();

  expect(within(newest).getByText('Example Preparer')).toBeTruthy();
  expect(within(newest).getByText(formatDateTime('2026-10-05T01:00:00Z'))).toBeTruthy();
  expect(within(newest).getByText('2026-09-20')).toBeTruthy();
  expect(within(newest).getByText(COPY.PROVIDED_BY_COMPANY)).toBeTruthy();
  expect(
    within(newest).getByText('ASIC extract, as stated by the company: 9,007,199,254,740,993 shares held by 1 member'),
  ).toBeTruthy();
  expect(within(newest).getByText('Import rows: 9,007,199,254,740,993 shares held by 1 member')).toBeTruthy();

  const trail = within(middle)
    .getAllByRole('term')
    .map((term) => [term.textContent, term.nextElementSibling?.textContent]);
  expect(trail).toContainEqual(['Approve', `Example Approver · ${formatDateTime(approval.decidedAt)}`]);
  expect(trail).toContainEqual(['Apply', `Example Approver · ${formatDateTime(application.decidedAt)}`]);
  expect(trail.findIndex(([term]) => term === 'Approve')).toBeLessThan(trail.findIndex(([term]) => term === 'Apply'));

  expect(within(oldest).getByText(COPY.STAFF_VERIFIED)).toBeTruthy();
  expect(within(oldest).queryByText('Prepared by')).toBeNull();
  expect(within(oldest).queryByText(/as stated by the company/)).toBeNull();
  expect(within(oldest).getByText('Superseded by the company-run import')).toBeTruthy();
  expect(within(oldest).getByRole('button', { name: COPY.DOWNLOAD_REGISTER })).toBeTruthy();
  expect(within(oldest).queryByRole('button', { name: COPY.DOWNLOAD_ASIC })).toBeNull();
  expect(within(newest).getByRole('button', { name: COPY.DOWNLOAD_ASIC })).toBeTruthy();
  expect(
    client.getQueryData<RegisterImport[]>(['tokens', 'register', 'profile-one', 'account-one', 'imports', 'ordinary']),
  ).toHaveLength(3);
});

it('says calmly that a class has no imports yet', async () => {
  imports = [];
  const section = await openClass();
  expect(within(section).getByText(COPY.EMPTY)).toBeTruthy();
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
] as const)('shows %s the history and the read-only note instead of actions', async (_who, role, held) => {
  appointments = [...held];
  const section = await openClass(role);
  expect(within(section).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(within(section).getByText('Example Preparer')).toBeTruthy();
  for (const kind of ['approve', 'apply', 'reject'] as const)
    expect(within(section).queryByRole('button', { name: COPY.DECISIONS[kind] })).toBeNull();
  expect(within(section).queryByRole('link', { name: COPY.PREPARE })).toBeNull();
  expect(within(section).getByRole('button', { name: COPY.DOWNLOAD_REGISTER })).toBeTruthy();
});

it.each([
  ['admin', ['Approve', 'Apply', 'Reject'], true],
  ['prepare', [], true],
  ['approve', ['Approve', 'Reject'], false],
  ['apply', ['Apply'], false],
] as const)('offers an appointment holding %s exactly its steps', async (capability, steps, prepares) => {
  appointments = [appointment([capability])];
  const section = await openClass();
  const [record] = records(section);
  expect(
    within(record)
      .queryAllByRole('button')
      .map((button) => button.textContent)
      .filter((label) => ['Approve', 'Apply', 'Reject'].includes(label ?? '')),
  ).toEqual(steps);
  const link = within(section).queryByRole('link', { name: COPY.PREPARE });
  expect(link?.getAttribute('href') ?? null).toBe(prepares ? '/company/register/ordinary/import' : null);
  expect(within(section).queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
});

it('offers a retained staff-era import only rejection, and no preparation once the class has an applied import', async () => {
  imports = [
    proposal({ uuid: 'import-applied', status: 'applied', stage: 'applied', createdAt: '2026-10-01T00:00:00Z' }),
    proposal({ providedBy: 'staff_verified', preparedByName: null, asicEvidence: null }),
  ];
  const section = await openClass();
  const staff = records(section).find((record) => within(record).queryByText(COPY.STAFF_VERIFIED))!;
  expect(within(staff).getByRole('button', { name: 'Reject' })).toBeTruthy();
  expect(within(staff).queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(within(staff).queryByRole('button', { name: 'Apply' })).toBeNull();
  expect(within(section).queryByRole('link', { name: COPY.PREPARE })).toBeNull();
});

it('previews an approval, then records exactly the previewed decision and refreshes the imports and register', async () => {
  const section = await openClass();
  const [record] = records(section);
  const dialog = await openDecision(record, 'approve');
  await within(dialog).findByText('Example Live Member');
  expect(writes(PREVIEW)).toEqual([
    [
      PREVIEW,
      { appointment: 'appointment-a', kind: 'approve', reason: '' },
      { ledovaSubmissionGuard: expect.any(Function) },
    ],
  ]);
  expect(within(dialog).getByText(COPY.CONFIRMATIONS.approve)).toBeTruthy();
  expect(
    within(dialog).getByText('ASIC extract, as stated by the company: 9,007,199,254,740,993 shares held by 1 member'),
  ).toBeTruthy();
  expect(within(dialog).getByText('Import rows: 9,007,199,254,740,993 shares held by 1 member')).toBeTruthy();
  const compared = within(dialog)
    .getAllByRole('term')
    .map((term) => [term.textContent, term.nextElementSibling?.textContent]);
  expect(compared).toEqual([
    ['Imported name', 'Example Member'],
    ['Imported shares', '9,007,199,254,740,993'],
    ['Stored shares', '9,007,199,254,740,993'],
    ['Imported date entered', '2019-05-01'],
    ['Stored date entered', '2026-09-01'],
    ['Live name', 'Example Live Member'],
    ['Wallets', WALLET],
  ]);
  expect(within(dialog).queryByText(COPY.NOT_ON_CHAIN_NOTE)).toBeNull();
  const holdersRead = reads(HOLDERS);
  const importsRead = reads(IMPORTS);
  imports = [
    decided({
      appointment: 'appointment-a',
      kind: 'approve',
      reason: '',
      idempotencyKey: KEY(1),
      previewDigest: DIGEST,
      confirmation: true,
    }),
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
  await waitFor(() => expect(reads(IMPORTS)).toBe(importsRead + 1));
  expect(reads(HOLDERS)).toBe(holdersRead + 1);
  expect(await within(section).findByText(COPY.STAGES.approved)).toBeTruthy();
  expect(within(section).getByText(`Example Decider · ${formatDateTime('2026-10-05T02:00:00Z')}`)).toBeTruthy();
});

it('lists unmet requirements in words and keeps the decision unconfirmable while any remain', async () => {
  previewFor = () =>
    preview({ canDecide: false, unmetRequirements: ['approval_required', 'holdings_differ', 'future_rule'] });
  const section = await openClass();
  const dialog = await openDecision(records(section)[0], 'apply');
  expect(await within(dialog).findByText(REGISTER_IMPORT_UNMET_COPY.approval_required)).toBeTruthy();
  expect(within(dialog).getByText(REGISTER_IMPORT_UNMET_COPY.holdings_differ)).toBeTruthy();
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
      const read = api.get.getMockImplementation()!;
      api.get.mockImplementation(async (url: string, config?: unknown) => {
        if (url === APPOINTMENTS) throw new Error('Unavailable');
        return read(url, config);
      });
    },
  ],
] as const)('holds a previewed decision once its step appointment is %s', async (_change, change) => {
  const section = await openClass();
  const dialog = await openDecision(records(section)[0], 'approve');
  await within(dialog).findByText('Example Live Member');
  expect(confirmButton(dialog, 'approve').disabled).toBe(false);
  change();
  await act(async () => {
    await client.refetchQueries({ queryKey: ['company-appointments', 'profile-one', 'account-one'] });
  });
  await waitFor(() => expect(confirmButton(dialog, 'approve').disabled).toBe(true));
  expect(within(dialog).getByText(/Your appointment for this step changed or could not be checked/)).toBeTruthy();
  fireEvent.click(confirmButton(dialog, 'approve'));
  expect(writes(DECIDE)).toHaveLength(0);
});

it.each([
  ['apply', true, true],
  ['approve', true, false],
  ['apply', false, false],
] as const)(
  'shows the not-on-chain note for %s when the preview opens the register (%s): %s',
  async (kind, opensRegister, shown) => {
    previewFor = () => preview({ opensRegister });
    const section = await openClass();
    const dialog = await openDecision(records(section)[0], kind);
    await within(dialog).findByText('Example Live Member');
    expect(!!within(dialog).queryByText(COPY.NOT_ON_CHAIN_NOTE)).toBe(shown);
  },
);

it('previews a rejection again with its reason and records exactly that reason', async () => {
  previewFor = ({ reason }) =>
    reason
      ? preview({ previewDigest: 'd'.repeat(64) })
      : preview({ canDecide: false, unmetRequirements: ['reason_required'] });
  const section = await openClass();
  const dialog = await openDecision(records(section)[0], 'reject');
  expect(await within(dialog).findByText(REGISTER_IMPORT_UNMET_COPY.reason_required)).toBeTruthy();
  expect(within(dialog).getByText(COPY.CONFIRMATIONS.reject)).toBeTruthy();
  const reason = within(dialog).getByLabelText(COPY.REJECTION_REASON);
  const again = within(dialog).getByRole('button', { name: 'Preview the rejection' }) as HTMLButtonElement;
  expect(confirmButton(dialog, 'reject').disabled).toBe(true);
  expect(again.disabled).toBe(true);
  fireEvent.change(reason, { target: { value: '  Superseded by a corrected register  ' } });
  fireEvent.click(again);
  await waitFor(() => expect(confirmButton(dialog, 'reject').disabled).toBe(false));
  expect(writes(PREVIEW).map(([, body]) => body)).toEqual([
    { appointment: 'appointment-a', kind: 'reject', reason: '' },
    { appointment: 'appointment-a', kind: 'reject', reason: 'Superseded by a corrected register' },
  ]);
  fireEvent.change(reason, { target: { value: 'Another reason' } });
  expect(confirmButton(dialog, 'reject').disabled).toBe(true);
  fireEvent.click(confirmButton(dialog, 'reject'));
  expect(writes(DECIDE)).toHaveLength(0);
  fireEvent.change(reason, { target: { value: 'Superseded by a corrected register' } });
  expect(confirmButton(dialog, 'reject').disabled).toBe(false);
  fireEvent.click(confirmButton(dialog, 'reject'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(writes(DECIDE).map(([, body]) => body)).toEqual([
    {
      appointment: 'appointment-a',
      kind: 'reject',
      reason: 'Superseded by a corrected register',
      idempotencyKey: KEY(2),
      previewDigest: 'd'.repeat(64),
      confirmation: true,
    },
  ]);
});

it('refuses an unconfirmed decision receipt and leaves the imports as they were', async () => {
  decideFor = async (body) => ({ data: decided({ ...body, idempotencyKey: KEY(99) }) });
  const section = await openClass();
  const importsRead = reads(IMPORTS);
  const holdersRead = reads(HOLDERS);
  const dialog = await openDecision(records(section)[0], 'apply');
  await within(dialog).findByText('Example Live Member');
  fireEvent.click(confirmButton(dialog, 'apply'));
  expect((await within(dialog).findByRole('alert')).textContent).toBe(COPY.DECISION_RECEIPT_FAILED);
  expect(reads(IMPORTS)).toBe(importsRead);
  expect(reads(HOLDERS)).toBe(holdersRead);
  expect(within(section).getByText(COPY.STAGES.submitted)).toBeTruthy();
  expect(confirmButton(dialog, 'apply').disabled).toBe(true);
});

it('shows a refused decision and refreshes the imports and register after a conflict', async () => {
  decideFor = async () => {
    throw {
      response: {
        status: 409,
        data: { detail: 'The register operation conflicts with its recorded identity or holdings.' },
      },
    };
  };
  const section = await openClass();
  const importsRead = reads(IMPORTS);
  const holdersRead = reads(HOLDERS);
  const dialog = await openDecision(records(section)[0], 'apply');
  await within(dialog).findByText('Example Live Member');
  fireEvent.click(confirmButton(dialog, 'apply'));
  expect((await within(dialog).findByRole('alert')).textContent).toBe(
    'The register operation conflicts with its recorded identity or holdings.',
  );
  await waitFor(() => expect(reads(IMPORTS)).toBe(importsRead + 1));
  expect(reads(HOLDERS)).toBe(holdersRead + 1);
});

it('retries an unconfirmed decision with the same key and takes a new key once the preview changes', async () => {
  decideFor = async () => {
    throw Object.assign(new Error('Unable to connect to our servers.'), { isUserFriendly: true });
  };
  const section = await openClass();
  const [record] = records(section);
  const confirmOnce = async () => {
    const dialog = await openDecision(record, 'approve');
    await within(dialog).findByText('Example Live Member');
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
  const pending = deferred<{ data: RegisterImportDecisionPreview }>();
  api.post.mockImplementation((url: string) => (url === PREVIEW ? pending.promise : Promise.reject(new Error(url))));
  const section = await openClass();
  fireEvent.click(within(records(section)[0]).getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(writes(PREVIEW)).toHaveLength(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: preview() }));
  expect(screen.queryByText('Example Live Member')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Approve import' })).toBeNull();
  expect(writes(DECIDE)).toHaveLength(0);
});

it('records nothing on the page or in the cache when a decision returns after the signed-in account changed', async () => {
  const pending = deferred<{ data: RegisterImport }>();
  decideFor = () => pending.promise;
  const section = await openClass();
  const dialog = await openDecision(records(section)[0], 'apply');
  await within(dialog).findByText('Example Live Member');
  const importsRead = reads(IMPORTS);
  const holdersRead = reads(HOLDERS);
  fireEvent.click(confirmButton(dialog, 'apply'));
  await waitFor(() => expect(writes(DECIDE)).toHaveLength(1));
  imports = [];
  act(switchAccount);
  const body = writes(DECIDE)[0][1] as RegisterImportDecideRequest;
  await act(async () => pending.resolve({ data: decided(body) }));
  expect(reads(IMPORTS)).toBe(importsRead);
  expect(reads(HOLDERS)).toBe(holdersRead);
  const previous = client.getQueryState(['tokens', 'register', 'profile-one', 'account-one', 'imports', 'ordinary']);
  expect(previous?.isInvalidated).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps each account to its own imports, showing none of the previous account while its own load', async () => {
  const section = await openClass();
  expect(within(section).getByText('Example Preparer')).toBeTruthy();
  const pending = deferred<ReturnType<typeof page>>();
  api.get.mockImplementation(async (url: string) => {
    if (url === REGISTER)
      return page([{ uuid: 'ordinary', companyUuid: 'harbour', companyName: 'Harbour Example Pty Ltd' }]);
    if (url === HOLDERS) return { data: holders() };
    if (url === APPOINTMENTS) return page([]);
    if (url === IMPORTS) return pending.promise;
    throw new Error(`Unexpected read ${url}`);
  });
  act(switchAccount);
  fireEvent.click(await screen.findByRole('button', { name: /Ordinary shares/ }));
  expect(await screen.findByText('Loading imports…')).toBeTruthy();
  expect(screen.queryByText('Example Preparer')).toBeNull();
  await act(async () => pending.resolve(page([])));
  expect(await screen.findByText(COPY.EMPTY)).toBeTruthy();
  expect(screen.queryByText('Example Preparer')).toBeNull();
  expect(client.getQueryData(['tokens', 'register', 'profile-two', 'account-two', 'imports', 'ordinary'])).toEqual([]);
});

it('downloads the register document and the ASIC extract under their retained names', async () => {
  const saved = stubDownloads();
  const section = await openClass();
  const [record] = records(section);
  fireEvent.click(within(record).getByRole('button', { name: COPY.DOWNLOAD_REGISTER }));
  await waitFor(() => expect(saved).toEqual(['members-register.pdf']));
  fireEvent.click(within(record).getByRole('button', { name: COPY.DOWNLOAD_ASIC }));
  await waitFor(() => expect(saved).toEqual(['members-register.pdf', 'asic-extract.pdf']));
  expect(api.get).toHaveBeenCalledWith(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_FILE('import-new'), {
    ledovaSubmissionGuard: expect.any(Function),
    responseType: 'blob',
  });
  expect(api.get).toHaveBeenCalledWith(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_ASIC_FILE('import-new'), {
    ledovaSubmissionGuard: expect.any(Function),
    responseType: 'blob',
  });
});

it('saves no evidence copy whose download returns after the signed-in account changed', async () => {
  const saved = stubDownloads();
  const pending = deferred<{ data: Blob }>();
  const section = await openClass();
  api.get.mockImplementation((url: string) => {
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_FILE('import-new')) return pending.promise;
    return Promise.resolve(page([]));
  });
  fireEvent.click(within(records(section)[0]).getByRole('button', { name: COPY.DOWNLOAD_REGISTER }));
  await waitFor(() => expect(reads(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_FILE('import-new'))).toBe(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: new Blob(['%PDF synthetic']) }));
  expect(saved).toEqual([]);
});

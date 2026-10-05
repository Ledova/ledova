// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  COMPANY_TOKEN_ENDPOINTS,
  REGISTER_RECONCILIATION_COPY,
  USER_PREFERENCES_QUERY_KEY,
  formatDateTime,
  type AccountRole,
  type CompanyCapability,
  type OwnCompanyAppointment,
  type RegisterAcknowledgeRequest,
  type RegisterDiscrepancy,
  type RegisterReconciliation,
  type TokenHoldersResponse,
} from '@ledova/shared';
import CompanyRegisterPage from '.';
import { companyPreferences, prepareCompanyClient, renderCompanyPage } from '../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

const REGISTER = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const HOLDERS = COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary');
const RECONCILIATIONS = COMPANY_TOKEN_ENDPOINTS.REGISTER_RECONCILIATIONS;
const ACKNOWLEDGE = COMPANY_TOKEN_ENDPOINTS.REGISTER_RECONCILIATION_ACKNOWLEDGE('reconciliation-latest');
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const APPOINTMENTS_KEY = ['company-appointments', 'profile-one', 'account-one'];
const RECONCILIATION_KEY = ['tokens', 'register', 'profile-one', 'account-one', 'reconciliation', 'ordinary'];
const COPY = REGISTER_RECONCILIATION_COPY;
const KEY = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const TRANSACTION = `0x${'1'.repeat(64)}`;
const ADDRESS = `0x${'2'.repeat(40)}`;
const DIALOG = `${COPY.ACKNOWLEDGE} discrepancy`;
const CHANGED = 'The reconciliation or your appointment changed or could not be checked. Cancel and start again.';
let client: QueryClient;
let appointments: OwnCompanyAppointment[];
let latest: RegisterReconciliation[];
let acknowledgeFor: (body: RegisterAcknowledgeRequest) => Promise<{ data: RegisterReconciliation }>;

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
        wallets: [],
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

function discrepancy(overrides: Partial<RegisterDiscrepancy>): RegisterDiscrepancy {
  return { kind: 'supply', acknowledgeable: true, acknowledgement: null, ...overrides };
}

function rowsOfEveryKind(): RegisterDiscrepancy[] {
  return [
    discrepancy({ kind: 'unrecognised_transfer', transaction: TRANSACTION, block: 1234500 }),
    discrepancy({ kind: 'member', member: 'member-one', chain: '9007199254740993', expected: '9007199254740990' }),
    discrepancy({ kind: 'unlinked', address: ADDRESS, chain: '3', expected: '0' }),
    discrepancy({
      kind: 'supply',
      chain: '1000003',
      expected: '1000000',
      acknowledgeable: false,
      acknowledgement: {
        reason: 'The directors accept the issue made outside the platform',
        appointment: 'appointment-b',
        acknowledgedByName: 'Example Approver',
        acknowledgedAt: '2026-10-04T06:00:00Z',
        providedBy: 'company',
      },
    }),
    discrepancy({
      kind: 'missing_transfer',
      effect: 'issue',
      source: 'source-issue',
      transaction: `0x${'3'.repeat(64)}`,
      acknowledgeable: false,
    }),
    discrepancy({ kind: 'attribution', effect: 'transfer', source: 'source-transfer', acknowledgeable: false }),
    discrepancy({ kind: 'attribution', detail: 'The opening evidence could not be read.', acknowledgeable: false }),
    discrepancy({
      kind: 'member',
      member: 'member-gone',
      chain: '0',
      expected: '5',
      acknowledgeable: false,
      acknowledgement: {
        reason: 'Accepted before acknowledgement was company-run',
        appointment: null,
        acknowledgedByName: null,
        acknowledgedAt: '2026-09-30T06:00:00Z',
        providedBy: 'staff',
      },
    }),
  ];
}

function reconciliation(overrides: Partial<RegisterReconciliation> = {}): RegisterReconciliation {
  return {
    uuid: 'reconciliation-latest',
    token: 'ordinary',
    status: 'discrepant',
    blockNumber: 1234567,
    blockHash: `0x${'ab'.repeat(32)}`,
    registerSequence: 9,
    failure: '',
    createdAt: '2026-10-05T06:50:00Z',
    latest: true,
    discrepancies: rowsOfEveryKind(),
    ...overrides,
  };
}

function acknowledged(request: RegisterAcknowledgeRequest, base = reconciliation()): RegisterReconciliation {
  return {
    ...base,
    discrepancies: base.discrepancies.map((row, at) =>
      at === request.discrepancy
        ? {
            ...row,
            acknowledgeable: false,
            acknowledgement: {
              reason: request.reason,
              appointment: request.appointment,
              acknowledgedByName: 'Example Approver',
              acknowledgedAt: '2026-10-05T07:00:00Z',
              providedBy: 'company',
            },
          }
        : row,
    ),
  };
}

function page<T>(results: T[]) {
  return { data: { results, count: results.length, next: null, previous: null } };
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

function acknowledgements() {
  return api.post.mock.calls.filter(([url]) => url === ACKNOWLEDGE);
}

function serve(read?: (url: string) => unknown) {
  api.get.mockImplementation(async (url: string) => {
    const answer = read?.(url);
    if (answer !== undefined) return answer;
    if (url === REGISTER)
      return page([{ uuid: 'ordinary', companyUuid: 'harbour', companyName: 'Harbour Example Pty Ltd' }]);
    if (url === HOLDERS) return { data: holders() };
    if (url === APPOINTMENTS) return page(appointments);
    if (url === RECONCILIATIONS) return page(latest);
    if (url.endsWith('/register/entries/') || url.startsWith('/api/v1/tokens/register-')) return page([]);
    throw new Error(`Unexpected read ${url}`);
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
  const heading = await screen.findByRole('heading', { level: 3, name: COPY.TITLE });
  const element = heading.parentElement!;
  await waitFor(() => expect(within(element).queryByRole('status')).toBeNull());
  return element;
}

function records(element: HTMLElement) {
  return within(element).getAllByRole('listitem');
}

function fields(element: HTMLElement) {
  return within(element)
    .getAllByRole('term')
    .map((term) => [term.textContent, term.nextElementSibling?.textContent]);
}

function offered(element: HTMLElement) {
  return records(element).map((record) => !!within(record).queryByRole('button', { name: COPY.ACKNOWLEDGE }));
}

async function openAcknowledgement(element: HTMLElement, index: number) {
  fireEvent.click(within(records(element)[index]).getByRole('button', { name: COPY.ACKNOWLEDGE }));
  return screen.findByRole('dialog', { name: DIALOG });
}

function confirmButton(dialog: HTMLElement) {
  return within(dialog).getByRole('button', { name: DIALOG }) as HTMLButtonElement;
}

function reasonField(dialog: HTMLElement) {
  return within(dialog).getByLabelText(COPY.ACKNOWLEDGE_REASON) as HTMLTextAreaElement;
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let keys = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => KEY(++keys) as ReturnType<typeof crypto.randomUUID>);
  appointments = [appointment(['admin'])];
  latest = [reconciliation()];
  acknowledgeFor = async (body) => ({ data: acknowledged(body) });
  serve();
  api.post.mockImplementation(async (url: string, body: RegisterAcknowledgeRequest) => {
    if (url === ACKNOWLEDGE) return acknowledgeFor(body);
    throw new Error(`Unexpected write ${url}`);
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it("reads only the class's latest reconciliation and says plainly when it has none", async () => {
  latest = [];
  const section = await openClass();
  expect(within(section).getByText(COPY.EMPTY)).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith(RECONCILIATIONS, {
    params: { token: 'ordinary', page: 1 },
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(reads(RECONCILIATIONS)).toBe(1);
  expect(within(section).queryByRole('listitem')).toBeNull();
});

it('shows only the newest reconciliation when the class has older ones', async () => {
  latest = [
    reconciliation(),
    reconciliation({
      uuid: 'reconciliation-older',
      status: 'matched',
      latest: false,
      discrepancies: [],
      createdAt: '2026-10-05T00:50:00Z',
    }),
  ];
  const section = await openClass();
  expect(within(section).getByText(COPY.STATUSES.discrepant)).toBeTruthy();
  expect(within(section).queryByText(COPY.STATUSES.matched)).toBeNull();
  expect(records(section)).toHaveLength(8);
});

it('shows a failed reconciliation with the reason it could not compare', async () => {
  latest = [
    reconciliation({
      status: 'failed',
      blockNumber: null,
      registerSequence: null,
      failure: 'The chain snapshot is below the opening boundary.',
      discrepancies: [],
    }),
  ];
  const section = await openClass();
  expect(fields(section)).toEqual([
    ['Status', COPY.STATUSES.failed],
    [COPY.FIELDS.block, 'Not recorded'],
    ['Register sequence compared', 'Not recorded'],
    ['Reconciled on', formatDateTime('2026-10-05T06:50:00Z')],
  ]);
  expect(within(section).getByText(COPY.FAILED_NOTE)).toBeTruthy();
  expect(within(section).getByText('The chain snapshot is below the opening boundary.')).toBeTruthy();
  expect(within(section).queryByRole('listitem')).toBeNull();
});

it("shows a matched reconciliation's block, compared register sequence and time, and nothing to acknowledge", async () => {
  latest = [reconciliation({ status: 'matched', discrepancies: [] })];
  const section = await openClass();
  expect(fields(section)).toEqual([
    ['Status', COPY.STATUSES.matched],
    [COPY.FIELDS.block, '1234567'],
    ['Register sequence compared', '9'],
    ['Reconciled on', formatDateTime('2026-10-05T06:50:00Z')],
  ]);
  expect(within(section).queryByText(COPY.FAILED_NOTE)).toBeNull();
  expect(within(section).queryByRole('listitem')).toBeNull();
  expect(within(section).queryByRole('button', { name: COPY.ACKNOWLEDGE })).toBeNull();
});

it('words each discrepancy as a sentence with its particulars and offers acknowledgement only where it can be', async () => {
  const section = await openClass();
  const rows = records(section);
  expect(rows).toHaveLength(8);
  rowsOfEveryKind().forEach((item, index) => expect(within(rows[index]).getByText(COPY.KINDS[item.kind])).toBeTruthy());
  expect(fields(rows[0])).toEqual([
    [COPY.FIELDS.transaction, TRANSACTION],
    [COPY.FIELDS.block, '1234500'],
  ]);
  expect(fields(rows[1])).toEqual([
    [COPY.FIELDS.member, 'Example Member'],
    [COPY.FIELDS.chain, '9,007,199,254,740,993'],
    [COPY.FIELDS.expected, '9,007,199,254,740,990'],
  ]);
  expect(fields(rows[2])).toEqual([
    [COPY.FIELDS.address, ADDRESS],
    [COPY.FIELDS.chain, '3'],
    [COPY.FIELDS.expected, '0'],
  ]);
  expect(fields(rows[4])).toEqual([
    [COPY.FIELDS.transaction, `0x${'3'.repeat(64)}`],
    [COPY.FIELDS.effect, 'issue'],
    [COPY.FIELDS.source, 'source-issue'],
  ]);
  expect(fields(rows[5])).toEqual([
    [COPY.FIELDS.effect, 'transfer'],
    [COPY.FIELDS.source, 'source-transfer'],
  ]);
  expect(fields(rows[6])).toEqual([[COPY.FIELDS.detail, 'The opening evidence could not be read.']]);
  expect(fields(rows[7])[0]).toEqual([COPY.FIELDS.member, 'member-gone']);
  expect(offered(section)).toEqual([true, true, true, false, false, false, false, false]);
  expect(rows.map((row) => !!within(row).queryByText(COPY.ACKNOWLEDGEABLE_NOTE))).toEqual([
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    false,
  ]);
  expect(rows.map((row) => !!within(row).queryByText(COPY.ATTRIBUTION_NOTE))).toEqual([
    false,
    false,
    false,
    false,
    true,
    true,
    true,
    false,
  ]);
  expect(fields(section).slice(0, 4)).toEqual([
    ['Status', COPY.STATUSES.discrepant],
    [COPY.FIELDS.block, '1234567'],
    ['Register sequence compared', '9'],
    ['Reconciled on', formatDateTime('2026-10-05T06:50:00Z')],
  ]);
});

it('shows each acknowledgement with its reason, who made it, when, and who provided it', async () => {
  const section = await openClass();
  const [, , , company, , , , staff] = records(section);
  expect(fields(company)).toEqual([
    [COPY.FIELDS.chain, '1,000,003'],
    [COPY.FIELDS.expected, '1,000,000'],
    ['Acknowledged by', 'Example Approver'],
    ['Acknowledged on', formatDateTime('2026-10-04T06:00:00Z')],
    [COPY.ACKNOWLEDGE_REASON, 'The directors accept the issue made outside the platform'],
  ]);
  expect(within(company).getByText(COPY.PROVIDED_BY.company)).toBeTruthy();
  expect(fields(staff).slice(3)).toEqual([
    ['Acknowledged on', formatDateTime('2026-09-30T06:00:00Z')],
    [COPY.ACKNOWLEDGE_REASON, 'Accepted before acknowledgement was company-run'],
  ]);
  expect(within(staff).getByText(COPY.PROVIDED_BY.staff)).toBeTruthy();
  expect(within(staff).queryByText(COPY.PROVIDED_BY.company)).toBeNull();
});

it.each([
  ['admin', 'company', [appointment(['admin'])], true],
  ['approve', 'company', [appointment(['approve'])], true],
  ['apply', 'company', [appointment(['apply'])], false],
  ['prepare', 'company', [appointment(['prepare'])], false],
  ['read_register', 'investor', [appointment(['read_register'])], false],
  ['no appointment', 'company', [], false],
  ['admin of another company', 'company', [appointment(['admin'], { company: 'inland' })], false],
  [
    'a revoked admin',
    'company',
    [appointment(['admin'], { status: 'revoked', isEffective: false, revokedAt: '2026-10-04T00:00:00Z' })],
    false,
  ],
] as const)('offers acknowledgement to an appointment holding %s: %s', async (_held, role, held, offers) => {
  appointments = [...held];
  const section = await openClass(role);
  expect(offered(section).some(Boolean)).toBe(offers);
  expect(!!within(section).queryByText(COPY.READ_ONLY_NOTE)).toBe(!offers);
  expect(records(section)).toHaveLength(8);
});

it('offers nothing on a row whose kind needs attribution or is unknown, whatever the server marks', async () => {
  latest = [
    reconciliation({
      discrepancies: [
        discrepancy({ kind: 'attribution', detail: 'Unplaced completion.' }),
        discrepancy({ kind: 'missing_transfer', transaction: TRANSACTION }),
        discrepancy({ kind: 'future_kind' }),
        discrepancy({ kind: 'supply', chain: '2', expected: '1', acknowledgeable: false }),
      ],
    }),
  ];
  const section = await openClass();
  expect(offered(section)).toEqual([false, false, false, false]);
  expect(within(records(section)[2]).getByText('future_kind')).toBeTruthy();
  expect(within(records(section)[0]).getByText(COPY.ATTRIBUTION_NOTE)).toBeTruthy();
});

it('acknowledges one discrepancy with its trimmed reason through the current appointment, then refreshes', async () => {
  const section = await openClass();
  const dialog = await openAcknowledgement(section, 1);
  expect(within(dialog).getByText(COPY.KINDS.member)).toBeTruthy();
  expect(within(dialog).getByText('Example Member')).toBeTruthy();
  expect(within(dialog).getByText(COPY.ACKNOWLEDGEMENT_NOTE)).toBeTruthy();
  expect(reasonField(dialog).maxLength).toBe(1000);
  expect(confirmButton(dialog).disabled).toBe(true);
  fireEvent.change(reasonField(dialog), { target: { value: '   ' } });
  expect(confirmButton(dialog).disabled).toBe(true);
  fireEvent.change(reasonField(dialog), { target: { value: '  The directors accept the transfer  ' } });
  expect(confirmButton(dialog).disabled).toBe(false);
  const read = reads(RECONCILIATIONS);
  latest = [
    acknowledged({
      appointment: 'appointment-a',
      discrepancy: 1,
      reason: 'The directors accept the transfer',
      idempotencyKey: KEY(1),
    }),
  ];
  fireEvent.click(confirmButton(dialog));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(acknowledgements()).toEqual([
    [
      ACKNOWLEDGE,
      {
        appointment: 'appointment-a',
        discrepancy: 1,
        reason: 'The directors accept the transfer',
        idempotencyKey: KEY(1),
      },
      { ledovaSubmissionGuard: expect.any(Function) },
    ],
  ]);
  await waitFor(() => expect(reads(RECONCILIATIONS)).toBe(read + 1));
  await waitFor(() => expect(offered(section)).toEqual([true, false, true, false, false, false, false, false]));
  expect(within(records(section)[1]).getByText('The directors accept the transfer')).toBeTruthy();
});

it('refuses an unconfirmed acknowledgement receipt and leaves the reconciliation as it was', async () => {
  acknowledgeFor = async () => ({ data: reconciliation() });
  const section = await openClass();
  const read = reads(RECONCILIATIONS);
  const dialog = await openAcknowledgement(section, 0);
  fireEvent.change(reasonField(dialog), { target: { value: 'Accepted' } });
  fireEvent.click(confirmButton(dialog));
  expect((await within(dialog).findByRole('alert')).textContent).toBe(COPY.ACKNOWLEDGEMENT_RECEIPT_FAILED);
  expect(reads(RECONCILIATIONS)).toBe(read);
  expect(screen.getByRole('dialog', { name: DIALOG })).toBeTruthy();
});

it('retries an unconfirmed acknowledgement with the same key and takes a new key for another reason', async () => {
  acknowledgeFor = async () => {
    throw Object.assign(new Error('Unable to connect to our servers.'), { isUserFriendly: true });
  };
  const section = await openClass();
  const dialog = await openAcknowledgement(section, 0);
  fireEvent.change(reasonField(dialog), { target: { value: 'Accepted' } });
  fireEvent.click(confirmButton(dialog));
  expect((await within(dialog).findByRole('alert')).textContent).toBe('Unable to connect to our servers.');
  fireEvent.click(confirmButton(dialog));
  await waitFor(() => expect(acknowledgements()).toHaveLength(2));
  await waitFor(() => expect(confirmButton(dialog).disabled).toBe(false));
  fireEvent.change(reasonField(dialog), { target: { value: 'Accepted after investigation' } });
  fireEvent.click(confirmButton(dialog));
  await waitFor(() => expect(acknowledgements()).toHaveLength(3));
  expect(acknowledgements().map(([, body]) => [body.idempotencyKey, body.reason])).toEqual([
    [KEY(1), 'Accepted'],
    [KEY(1), 'Accepted'],
    [KEY(2), 'Accepted after investigation'],
  ]);
});

it('shows a refused acknowledgement, refreshes the reconciliation and appointments, and holds a stale row', async () => {
  acknowledgeFor = async () => {
    throw { response: { status: 400, data: { detail: 'This discrepancy is already acknowledged.' } } };
  };
  const section = await openClass();
  const before = [reads(RECONCILIATIONS), reads(APPOINTMENTS)];
  const dialog = await openAcknowledgement(section, 0);
  fireEvent.change(reasonField(dialog), { target: { value: 'Accepted' } });
  latest = [
    acknowledged({ appointment: 'appointment-b', discrepancy: 0, reason: 'Accepted elsewhere', idempotencyKey: 'x' }),
  ];
  fireEvent.click(confirmButton(dialog));
  expect((await within(dialog).findAllByRole('alert'))[0].textContent).toBe(
    'This discrepancy is already acknowledged.',
  );
  await waitFor(() => expect([reads(RECONCILIATIONS), reads(APPOINTMENTS)]).toEqual(before.map((count) => count + 1)));
  expect(await within(dialog).findByText(CHANGED)).toBeTruthy();
  expect(confirmButton(dialog).disabled).toBe(true);
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
      appointments = [appointment(['approve'], { uuid: 'appointment-0' })];
    },
  ],
  ['unreadable', () => serve((url) => (url === APPOINTMENTS ? Promise.reject(new Error('Unavailable')) : undefined))],
] as const)('holds an open acknowledgement once its appointment is %s', async (_change, change) => {
  const section = await openClass();
  const dialog = await openAcknowledgement(section, 0);
  fireEvent.change(reasonField(dialog), { target: { value: 'Accepted' } });
  expect(confirmButton(dialog).disabled).toBe(false);
  change();
  await act(async () => {
    await client.refetchQueries({ queryKey: APPOINTMENTS_KEY });
  });
  await waitFor(() => expect(confirmButton(dialog).disabled).toBe(true));
  expect(within(dialog).getByText(CHANGED)).toBeTruthy();
  fireEvent.click(confirmButton(dialog));
  expect(acknowledgements()).toHaveLength(0);
});

it('holds an open acknowledgement once a refresh brings a newer reconciliation', async () => {
  const section = await openClass();
  const dialog = await openAcknowledgement(section, 0);
  fireEvent.change(reasonField(dialog), { target: { value: 'Accepted' } });
  latest = [reconciliation({ uuid: 'reconciliation-newer', createdAt: '2026-10-05T12:50:00Z' })];
  await act(async () => {
    await client.refetchQueries({ queryKey: RECONCILIATION_KEY });
  });
  await waitFor(() => expect(confirmButton(dialog).disabled).toBe(true));
  expect(within(dialog).getByText(CHANGED)).toBeTruthy();
  fireEvent.click(confirmButton(dialog));
  expect(acknowledgements()).toHaveLength(0);
});

it('holds an open acknowledgement and hides the rows once the reconciliation cannot be read again', async () => {
  const section = await openClass();
  const dialog = await openAcknowledgement(section, 0);
  fireEvent.change(reasonField(dialog), { target: { value: 'Accepted' } });
  serve((url) => (url === RECONCILIATIONS ? Promise.reject(new Error('Unavailable')) : undefined));
  await act(async () => {
    await client.refetchQueries({ queryKey: RECONCILIATION_KEY });
  });
  await waitFor(() => expect(confirmButton(dialog).disabled).toBe(true));
  expect(within(dialog).getByText(CHANGED)).toBeTruthy();
  expect(within(section).queryByText(TRANSACTION)).toBeNull();
  fireEvent.click(confirmButton(dialog));
  expect(acknowledgements()).toHaveLength(0);
});

it('clears an earlier failure once the reason changes or another discrepancy is opened', async () => {
  acknowledgeFor = async () => {
    throw Object.assign(new Error('Unable to connect to our servers.'), { isUserFriendly: true });
  };
  const section = await openClass();
  let dialog = await openAcknowledgement(section, 0);
  fireEvent.change(reasonField(dialog), { target: { value: 'Accepted' } });
  fireEvent.click(confirmButton(dialog));
  expect((await within(dialog).findByRole('alert')).textContent).toBe('Unable to connect to our servers.');
  fireEvent.change(reasonField(dialog), { target: { value: 'Accepted after review' } });
  expect(within(dialog).queryByRole('alert')).toBeNull();
  fireEvent.click(confirmButton(dialog));
  await within(dialog).findByRole('alert');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  dialog = await openAcknowledgement(section, 2);
  expect(reasonField(dialog).value).toBe('');
  expect(within(dialog).queryByRole('alert')).toBeNull();
  expect(within(dialog).getByText(COPY.KINDS.unlinked)).toBeTruthy();
});

it('records and refreshes nothing when an acknowledgement returns after the signed-in account changed', async () => {
  const pending = deferred<{ data: RegisterReconciliation }>();
  acknowledgeFor = () => pending.promise;
  const section = await openClass();
  const dialog = await openAcknowledgement(section, 0);
  fireEvent.change(reasonField(dialog), { target: { value: 'Accepted' } });
  const read = reads(RECONCILIATIONS);
  fireEvent.click(confirmButton(dialog));
  await waitFor(() => expect(acknowledgements()).toHaveLength(1));
  act(switchAccount);
  const body = acknowledgements()[0][1] as RegisterAcknowledgeRequest;
  await act(async () => pending.resolve({ data: acknowledged(body) }));
  expect(reads(RECONCILIATIONS)).toBe(read);
  expect(client.getQueryState(RECONCILIATION_KEY)?.isInvalidated).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps the acknowledgement dialog open while the acknowledgement is being recorded', async () => {
  const pending = deferred<{ data: RegisterReconciliation }>();
  acknowledgeFor = () => pending.promise;
  const section = await openClass();
  const dialog = await openAcknowledgement(section, 0);
  fireEvent.change(reasonField(dialog), { target: { value: 'Accepted' } });
  fireEvent.click(confirmButton(dialog));
  await waitFor(() => expect(acknowledgements()).toHaveLength(1));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(reasonField(screen.getByRole('dialog', { name: DIALOG })).value).toBe('Accepted');
  await act(async () =>
    pending.resolve({ data: acknowledged(acknowledgements()[0][1] as RegisterAcknowledgeRequest) }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('refreshes nothing when a refused acknowledgement returns after the signed-in account changed', async () => {
  let refuse!: (failure: unknown) => void;
  acknowledgeFor = () =>
    new Promise((_resolve, reject) => {
      refuse = reject;
    });
  const section = await openClass();
  const dialog = await openAcknowledgement(section, 0);
  fireEvent.change(reasonField(dialog), { target: { value: 'Accepted' } });
  fireEvent.click(confirmButton(dialog));
  await waitFor(() => expect(acknowledgements()).toHaveLength(1));
  act(switchAccount);
  await act(async () =>
    refuse({ response: { status: 400, data: { detail: 'This discrepancy is already acknowledged.' } } }),
  );
  expect(client.getQueryState(RECONCILIATION_KEY)?.isInvalidated).toBe(false);
  expect(client.getQueryState(APPOINTMENTS_KEY)?.isInvalidated).toBe(false);
});

it('shows no read-only note while the appointments are still loading', async () => {
  const pending = deferred<ReturnType<typeof page>>();
  serve((url) => (url === APPOINTMENTS ? pending.promise : undefined));
  const section = await openClass();
  expect(within(section).queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
  expect(offered(section).some(Boolean)).toBe(false);
  await act(async () => pending.resolve(page([appointment(['admin'])])));
  await waitFor(() => expect(offered(section).some(Boolean)).toBe(true));
  expect(within(section).queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
});

it('keeps each account to its own reconciliation, showing none of the previous account while its own loads', async () => {
  const section = await openClass();
  expect(within(section).getByText(TRANSACTION)).toBeTruthy();
  const pending = deferred<ReturnType<typeof page>>();
  serve((url) => (url === RECONCILIATIONS ? pending.promise : url === APPOINTMENTS ? page([]) : undefined));
  act(switchAccount);
  fireEvent.click(await screen.findByRole('button', { name: /Ordinary shares/ }));
  expect(await screen.findByText('Loading the reconciliation…')).toBeTruthy();
  expect(screen.queryByText(TRANSACTION)).toBeNull();
  await act(async () => pending.resolve(page([])));
  expect(await screen.findByText(COPY.EMPTY)).toBeTruthy();
  expect(client.getQueryData(['tokens', 'register', 'profile-two', 'account-two', 'reconciliation', 'ordinary'])).toBe(
    null,
  );
});

it('refuses a reconciliation that names another share class, and offers a retry', async () => {
  latest = [reconciliation({ token: 'preference' })];
  const section = await openClass();
  expect(within(section).getByRole('alert').textContent).toContain(
    "We couldn't load the reconciliation for this share class.",
  );
  expect(within(section).queryByText(TRANSACTION)).toBeNull();
  latest = [reconciliation()];
  fireEvent.click(within(section).getByRole('button', { name: 'Retry reconciliation' }));
  expect(await within(section).findByText(TRANSACTION)).toBeTruthy();
  expect(within(section).queryByRole('alert')).toBeNull();
});

it('withdraws acknowledgement once a refresh shows the appointment revoked', async () => {
  const section = await openClass();
  expect(offered(section).some(Boolean)).toBe(true);
  appointments = [appointment(['admin'], { status: 'revoked', isEffective: false, revokedAt: '2026-10-05T03:00:00Z' })];
  await act(async () => {
    await client.refetchQueries({ queryKey: APPOINTMENTS_KEY });
  });
  await waitFor(() => expect(offered(section).some(Boolean)).toBe(false));
  expect(within(section).getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('withholds acknowledgement while the appointments cannot be read, and offers their retry', async () => {
  let fail = true;
  serve((url) => (url === APPOINTMENTS && fail ? Promise.reject(new Error('Unavailable')) : undefined));
  const section = await openClass();
  await waitFor(() =>
    expect(within(section).getByRole('alert').textContent).toContain(
      'Your appointments could not be loaded. Retry before acknowledging a discrepancy.',
    ),
  );
  expect(offered(section).some(Boolean)).toBe(false);
  expect(within(section).queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
  fail = false;
  fireEvent.click(within(section).getByRole('button', { name: 'Retry appointments' }));
  await waitFor(() => expect(offered(section).some(Boolean)).toBe(true));
});

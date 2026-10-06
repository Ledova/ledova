// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AxiosInstance } from 'axios';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ApiClientProvider,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  COMPANY_TOKEN_ENDPOINTS,
  DESTINATIONS,
  REGISTER_OPENING_COPY,
  USER_PREFERENCES_QUERY_KEY,
  type CompanyCapability,
  type OwnCompanyAppointment,
  type RegisterEvidence,
  type RegisterEvidenceKind,
  type RegisterOpeningHolders,
  type RegisterOpeningPreparation,
  type RegisterOpeningRecord,
} from '@ledova/shared';
import { PageTitle } from '@components/PageTitle';
import apiClient from '@services/apiClient';
import CompanyRegisterOpeningPage from '.';
import { companyPreferences, prepareCompanyClient } from '../../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

const REGISTER = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const HOLDERS = COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENING_HOLDERS('ordinary');
const EVIDENCE = COMPANY_TOKEN_ENDPOINTS.REGISTER_EVIDENCE;
const OPENINGS = COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENINGS;
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const ACCOUNT = ['tokens', 'register', 'profile-one', 'account-one'];
const OPENINGS_KEY = [...ACCOUNT, 'openings', 'ordinary'];
const HOLDERS_KEY = [...ACCOUNT, 'holders', 'opening', 'ordinary'];
const APPOINTMENTS_KEY = ['company-appointments', 'profile-one', 'account-one'];
const COPY = REGISTER_OPENING_COPY;
const KEY = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const MOVED = 'The opening mapping must cover exactly the wallet addresses holding shares at the captured boundary.';
const AUTHORITY_FILE = new File(['%PDF signed resolution'], 'signed-resolution.pdf', { type: 'application/pdf' });
const LISTED = {
  uuid: 'ordinary',
  companyUuid: 'harbour',
  companyName: 'Harbour Example Pty Ltd',
  name: 'Ordinary shares',
  symbol: 'ORD',
};
const ADA = `0x${'a'.repeat(40)}`;
const BO = `0x${'b'.repeat(40)}`;
const CY = `0x${'c'.repeat(40)}`;
const DEE = `0x${'d'.repeat(40)}`;
const EVE = `0x${'e'.repeat(40)}`;
const MEMBER_ADA = '10000000-0000-4000-8000-0000000000aa';
let client: QueryClient;
let appointments: OwnCompanyAppointment[];
let chain: RegisterOpeningHolders;
let uploadFor: (form: FormData) => Promise<{ data: RegisterEvidence }>;
let prepareFor: (body: RegisterOpeningPreparation) => Promise<{ data: RegisterOpeningRecord }>;

function holders(holdings: RegisterOpeningHolders['holdings'] = HOLDINGS): RegisterOpeningHolders {
  return { block: { number: 12, hash: `0x${'f'.repeat(64)}`, date: '2026-10-05' }, holdings };
}

const HOLDINGS: RegisterOpeningHolders['holdings'] = [
  { address: BO, shares: '9007199254740993', member: null, memberName: null, memberExists: false },
  { address: ADA, shares: '20', member: MEMBER_ADA, memberName: 'Ada Member', memberExists: true },
  { address: CY, shares: '5', member: null, memberName: null, memberExists: false },
  { address: DEE, shares: '1', member: null, memberName: null, memberExists: false },
];

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

function receipt(form: FormData): RegisterEvidence {
  const file = form.get('file') as File;
  return {
    uuid: `evidence-${form.get('idempotency_key')}`,
    company: form.get('company_id') as string,
    appointment: form.get('appointment') as string,
    kind: form.get('kind') as RegisterEvidenceKind,
    idempotencyKey: form.get('idempotency_key') as string,
    originalFilename: file.name,
    fileSize: file.size,
    mimeType: file.type,
    sha256: 'f'.repeat(64),
    providedBy: 'company',
    createdAt: '2026-10-05T00:00:00Z',
  };
}

function prepared(body: RegisterOpeningPreparation): RegisterOpeningRecord {
  return {
    uuid: body.operationId,
    company: 'harbour',
    token: body.tokenId,
    mapping: body.mapping,
    boundary: {},
    boundarySummary: {
      blockNumber: 13,
      blockHash: `0x${'f'.repeat(64)}`,
      date: '2026-10-05',
      holdings: chain.holdings,
    },
    authority: body.authority,
    approvingDirector: body.approvingDirector ?? '',
    authorityReference: body.authorityReference,
    reason: body.reason,
    sourceDocument: null,
    evidenceFingerprint: 'f'.repeat(64),
    evidenceSnapshot: { name: AUTHORITY_FILE.name },
    authorityEvidence: body.authorityEvidence,
    preparingAppointment: body.appointment,
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
    createdAt: '2026-10-05T03:00:00Z',
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

function uploads() {
  return api.post.mock.calls.filter(([url]) => url === EVIDENCE).map(([, form]) => form as FormData);
}

function preparations() {
  return api.post.mock.calls.filter(([url]) => url === OPENINGS).map(([, body]) => body as RegisterOpeningPreparation);
}

function refusal(status: number, data: unknown) {
  return { response: { status, data } };
}

function switchAccount() {
  const other = companyPreferences('company');
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { ...other, userProfile: 'profile-two', userAccount: { ...other.userAccount!, uuid: 'account-two' } },
  });
}

function serve(read?: (url: string) => unknown) {
  api.get.mockImplementation(async (url: string) => {
    const answer = read?.(url);
    if (answer !== undefined) return answer;
    if (url === REGISTER) return page([LISTED]);
    if (url === APPOINTMENTS) return page(appointments);
    if (url === HOLDERS) return { data: chain };
    throw new Error(`Unexpected read ${url}`);
  });
}

function show() {
  prepareCompanyClient(client, 'company');
  client.setQueryData(['userAccount'], { data: { role: 'company' } });
  client.setQueryData(OPENINGS_KEY, []);
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient as unknown as AxiosInstance}>
        <MemoryRouter initialEntries={['/company/register/ordinary/open']}>
          <PageTitle.Provider value="Register">
            <Routes>
              <Route path={DESTINATIONS.companyRegisterOpening.path} element={<CompanyRegisterOpeningPage />} />
              <Route path={DESTINATIONS.companyRegister.path} element={<p>Register page</p>} />
            </Routes>
          </PageTitle.Provider>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

function submitButton() {
  return screen.getByRole('button', { name: /Prepare opening|Preparing opening/ }) as HTMLButtonElement;
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function attach(file: File) {
  fireEvent.change(screen.getByLabelText(COPY.AUTHORITY_DOCUMENT), { target: { files: [file] } });
}

function complete() {
  attach(AUTHORITY_FILE);
  fill(COPY.APPROVING_DIRECTOR, '  Example Director  ');
  fill(COPY.AUTHORITY_REFERENCE, 'RESOLUTION-OPENING-1');
  fill(COPY.REASON, '  Open the register from the chain  ');
}

async function ready() {
  await screen.findByLabelText(COPY.AUTHORITY_DOCUMENT);
}

function holding(address: string) {
  return screen.getByRole('group', { name: address });
}

function memberOf(address: string) {
  return within(holding(address)).getByLabelText(COPY.MEMBER) as HTMLSelectElement;
}

function choose(address: string, label: string) {
  const select = memberOf(address);
  const option = [...select.options].find((item) => item.textContent === label)!;
  fireEvent.change(select, { target: { value: option.value } });
}

function chosen(address: string) {
  const select = memberOf(address);
  return select.options[select.selectedIndex].textContent;
}

function mappingOf(body: RegisterOpeningPreparation) {
  return body.mapping.map(({ address, member }) => [address, member]);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let keys = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => KEY(++keys) as ReturnType<typeof crypto.randomUUID>);
  appointments = [appointment(['prepare'])];
  chain = holders();
  uploadFor = async (form) => ({ data: receipt(form) });
  prepareFor = async (body) => ({ data: prepared(body) });
  serve();
  api.post.mockImplementation(async (url: string, body: unknown) => {
    if (url === EVIDENCE) return uploadFor(body as FormData);
    if (url === OPENINGS) return prepareFor(body as RegisterOpeningPreparation);
    throw new Error(`Unexpected write ${url}`);
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('shows the class, the block read and each holding with its member, then prepares exactly that mapping', async () => {
  show();
  await ready();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Register');
  expect(screen.getByRole('heading', { level: 2, name: 'Ordinary shares' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2, name: COPY.PREPARE })).toBeTruthy();
  expect(screen.getByText('Harbour Example Pty Ltd · ORD')).toBeTruthy();
  expect(screen.getByText('Holdings read at').nextElementSibling?.textContent).toBe(
    COPY.BOUNDARY_BLOCK(12, '2026-10-05'),
  );
  expect(screen.getByText(COPY.BOUNDARY_NOTE)).toBeTruthy();
  expect(screen.getByText(COPY.HOLDINGS_NOTE)).toBeTruthy();
  expect(screen.getByText(COPY.AUTHORITY_DOCUMENT_NOTE)).toBeTruthy();
  expect(screen.getByRole('group', { name: COPY.HOLDINGS })).toBeTruthy();
  expect(api.get.mock.calls.filter(([url]) => url === HOLDERS)).toEqual([
    [HOLDERS, { ledovaSubmissionGuard: expect.any(Function) }],
  ]);
  expect(
    screen
      .getAllByRole('group')
      .filter((group) => group.querySelector('legend')?.className.includes('break-all'))
      .map((group) => group.querySelector('legend')?.textContent),
  ).toEqual([BO, ADA, CY, DEE]);
  expect(within(holding(BO)).getByText('9,007,199,254,740,993 shares')).toBeTruthy();
  expect(within(holding(DEE)).getByText('1 share')).toBeTruthy();
  expect(within(holding(ADA)).getByText('Ada Member')).toBeTruthy();
  expect(within(holding(ADA)).getByText(COPY.LINKED_NOTE)).toBeTruthy();
  expect(within(holding(ADA)).queryByLabelText(COPY.MEMBER)).toBeNull();
  expect(screen.getByText(/Choose the same member for addresses that belong to one person/)).toBeTruthy();
  expect([chosen(BO), chosen(CY), chosen(DEE)]).toEqual([
    COPY.NEW_MEMBER_NUMBERED(1),
    COPY.NEW_MEMBER_NUMBERED(2),
    COPY.NEW_MEMBER_NUMBERED(3),
  ]);
  expect([...memberOf(CY).options].map((option) => option.textContent)).toEqual([
    'Ada Member',
    COPY.NEW_MEMBER_NUMBERED(1),
    COPY.NEW_MEMBER_NUMBERED(2),
    COPY.NEW_MEMBER_NUMBERED(3),
  ]);
  expect(submitButton().disabled).toBe(true);

  complete();
  expect(submitButton().disabled).toBe(false);
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => Object.fromEntries(form.entries()))).toEqual([
    {
      company_id: 'harbour',
      appointment: 'appointment-a',
      kind: 'authority',
      idempotency_key: KEY(4),
      file: AUTHORITY_FILE,
    },
  ]);
  expect(preparations()).toEqual([
    {
      operationId: KEY(5),
      appointment: 'appointment-a',
      tokenId: 'ordinary',
      authorityEvidence: `evidence-${KEY(4)}`,
      mapping: [
        { address: BO, member: KEY(1) },
        { address: ADA, member: MEMBER_ADA },
        { address: CY, member: KEY(2) },
        { address: DEE, member: KEY(3) },
      ],
      authority: 'director_resolution',
      approvingDirector: 'Example Director',
      authorityReference: 'RESOLUTION-OPENING-1',
      reason: 'Open the register from the chain',
    },
  ]);
  expect(api.post.mock.calls.find(([url]) => url === OPENINGS)?.[2]).toEqual({
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(client.getQueryState(OPENINGS_KEY)?.isInvalidated).toBe(true);
});

it('lets several addresses share one new member and an unlinked address join a linked member', async () => {
  show();
  await ready();
  complete();
  choose(CY, COPY.NEW_MEMBER_NUMBERED(1));
  choose(DEE, 'Ada Member');
  expect([chosen(BO), chosen(CY), chosen(DEE)]).toEqual([
    COPY.NEW_MEMBER_NUMBERED(1),
    COPY.NEW_MEMBER_NUMBERED(1),
    'Ada Member',
  ]);
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(mappingOf(preparations()[0])).toEqual([
    [BO, KEY(1)],
    [ADA, MEMBER_ADA],
    [CY, KEY(1)],
    [DEE, MEMBER_ADA],
  ]);
});

it('names an unnamed linked member as a member, and offers it to the unlinked addresses', async () => {
  chain = holders([
    { address: ADA, shares: '20', member: MEMBER_ADA, memberName: null, memberExists: true },
    { address: BO, shares: '5', member: null, memberName: null, memberExists: false },
  ]);
  show();
  await ready();
  expect(within(holding(ADA)).getByText(COPY.MEMBER)).toBeTruthy();
  expect([...memberOf(BO).options].map((option) => option.textContent)).toEqual([
    COPY.MEMBER,
    COPY.NEW_MEMBER_NUMBERED(1),
  ]);
});

it('says a class with no holdings on chain records an empty register, and prepares an empty mapping', async () => {
  chain = holders([]);
  show();
  await ready();
  expect(screen.getByText(COPY.NO_HOLDINGS)).toBeTruthy();
  expect(screen.queryByLabelText(COPY.MEMBER)).toBeNull();
  expect(screen.queryByText(/Choose the same member for addresses that belong to one person/)).toBeNull();
  complete();
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations()[0].mapping).toEqual([]);
});

it('names an approving director only for a resolution and sends none for a court order', async () => {
  show();
  await ready();
  expect(
    [...(screen.getByLabelText(COPY.AUTHORITY) as HTMLSelectElement).options].map((option) => [
      option.value,
      option.textContent,
    ]),
  ).toEqual([
    ['director_resolution', COPY.AUTHORITIES.director_resolution],
    ['court_order', COPY.AUTHORITIES.court_order],
  ]);
  complete();
  fill(COPY.APPROVING_DIRECTOR, ' ');
  expect(submitButton().disabled).toBe(true);
  expect(screen.getByText('Name the approving director for a resolution.')).toBeTruthy();
  fill(COPY.APPROVING_DIRECTOR, 'Example Director');
  fireEvent.change(screen.getByLabelText(COPY.AUTHORITY), { target: { value: 'court_order' } });
  expect(screen.queryByLabelText(COPY.APPROVING_DIRECTOR)).toBeNull();
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations()[0]).toMatchObject({ authority: 'court_order', approvingDirector: '' });
});

it('needs the authority document, the reference and the reason before preparing', async () => {
  show();
  await ready();
  expect(
    [COPY.APPROVING_DIRECTOR, COPY.AUTHORITY_REFERENCE, COPY.REASON].map(
      (label) => (screen.getByLabelText(label) as HTMLInputElement).maxLength,
    ),
  ).toEqual([255, 255, 1000]);
  complete();
  fill(COPY.AUTHORITY_REFERENCE, ' ');
  expect(screen.getByText('Give the authority reference and the reason.')).toBeTruthy();
  expect(submitButton().disabled).toBe(true);
  fill(COPY.AUTHORITY_REFERENCE, 'RESOLUTION-OPENING-1');
  fill(COPY.REASON, ' ');
  expect(submitButton().disabled).toBe(true);
  fill(COPY.REASON, 'Open the register from the chain');
  fireEvent.change(screen.getByLabelText(COPY.AUTHORITY_DOCUMENT), { target: { files: [] } });
  expect(screen.getByText('Choose the authority document.')).toBeTruthy();
  expect(submitButton().disabled).toBe(true);
  fireEvent.click(submitButton());
  fireEvent.submit(submitButton().closest('form')!);
  expect(api.post).not.toHaveBeenCalled();
});

it('shows an appointee without a prepare capability the read-only note, no form and no chain read', async () => {
  appointments = [appointment(['approve', 'apply', 'read_register'])];
  show();
  expect(await screen.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(screen.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
  expect(reads(HOLDERS)).toBe(0);
});

it('says when the share class is not in a register the person can read, without reading the chain', async () => {
  serve((url) => (url === REGISTER ? page([]) : undefined));
  show();
  expect(await screen.findByText('This share class is not in a register you can read.')).toBeTruthy();
  expect(reads(HOLDERS)).toBe(0);
});

it("says the chain can't be read now when the holders read answers 503, and reads again on Try again", async () => {
  let unavailable = true;
  serve((url) =>
    url === HOLDERS && unavailable
      ? Promise.reject(refusal(503, { detail: 'A complete canonical register snapshot could not be read.' }))
      : undefined,
  );
  show();
  expect((await screen.findByRole('alert')).textContent).toContain(COPY.HOLDERS_UNAVAILABLE);
  expect(screen.queryByText('A complete canonical register snapshot could not be read.')).toBeNull();
  expect(screen.queryByLabelText(COPY.AUTHORITY_DOCUMENT)).toBeNull();
  unavailable = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await ready();
  expect(reads(HOLDERS)).toBe(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each([
  ['This share class already has a stored register.', ['This share class already has a stored register.']],
  ['A register opening requires a deployed share class.', ['A register opening requires a deployed share class.']],
  ['This share class cannot be opened from the chain.', {}],
])("shows the server's refusal of a class it will not open, %s, and no form", async (message, body) => {
  serve((url) => (url === HOLDERS ? Promise.reject(refusal(400, body)) : undefined));
  show();
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.queryByLabelText(COPY.AUTHORITY_DOCUMENT)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});

it.each([
  ['a holders read that fails otherwise', () => Promise.reject(new Error('Network Error'))],
  [
    'holdings that are not whole share counts',
    () => ({ data: holders([{ address: ADA, shares: '1.5', member: null, memberName: null, memberExists: false }]) }),
  ],
])('shows %s as an incomplete register with a retry', async (_what, answer) => {
  serve((url) => (url === HOLDERS ? answer() : undefined));
  show();
  expect((await screen.findByRole('alert')).textContent).toContain("We couldn't load the complete register.");
  expect(screen.queryByLabelText(COPY.AUTHORITY_DOCUMENT)).toBeNull();
  serve();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await ready();
});

it("after a holdings-moved refusal shows the server's message and reloads the holders, mapping them afresh", async () => {
  prepareFor = async () => {
    throw refusal(400, [MOVED]);
  };
  show();
  await ready();
  complete();
  choose(CY, COPY.NEW_MEMBER_NUMBERED(1));
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(MOVED);
  expect(screen.getByText(COPY.HOLDINGS_MOVED)).toBeTruthy();
  const before = reads(HOLDERS);
  chain = holders([
    { address: EVE, shares: '7', member: null, memberName: null, memberExists: false },
    { address: ADA, shares: '20', member: MEMBER_ADA, memberName: 'Ada Member', memberExists: true },
    { address: BO, shares: '3', member: null, memberName: null, memberExists: false },
    { address: CY, shares: '5', member: null, memberName: null, memberExists: false },
  ]);
  fireEvent.click(screen.getByRole('button', { name: COPY.RELOAD_HOLDINGS }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText(COPY.HOLDINGS_MOVED)).toBeNull();
  await waitFor(() => expect(screen.getByRole('group', { name: EVE })).toBeTruthy());
  expect(reads(HOLDERS)).toBe(before + 1);
  expect(screen.queryByRole('group', { name: DEE })).toBeNull();
  expect([chosen(EVE), chosen(BO), chosen(CY)]).toEqual([
    COPY.NEW_MEMBER_NUMBERED(1),
    COPY.NEW_MEMBER_NUMBERED(2),
    COPY.NEW_MEMBER_NUMBERED(3),
  ]);
  expect((screen.getByLabelText(COPY.REASON) as HTMLTextAreaElement).value).toBe(
    '  Open the register from the chain  ',
  );
  prepareFor = async (body) => ({ data: prepared(body) });
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => form.get('idempotency_key'))).toEqual([KEY(3)]);
  expect(preparations().map((body) => [body.operationId, mappingOf(body)])).toEqual([
    [
      KEY(4),
      [
        [BO, KEY(1)],
        [ADA, MEMBER_ADA],
        [CY, KEY(1)],
        [DEE, KEY(2)],
      ],
    ],
    [
      KEY(6),
      [
        [EVE, KEY(1)],
        [ADA, MEMBER_ADA],
        [BO, KEY(5)],
        [CY, KEY(2)],
      ],
    ],
  ]);
});

it('keeps the chosen members when reloading returns the same holdings, and retries under the same operation', async () => {
  prepareFor = async () => {
    throw refusal(400, [MOVED]);
  };
  show();
  await ready();
  complete();
  choose(CY, COPY.NEW_MEMBER_NUMBERED(1));
  fireEvent.click(submitButton());
  await screen.findByText(COPY.HOLDINGS_MOVED);
  fireEvent.click(screen.getByRole('button', { name: COPY.RELOAD_HOLDINGS }));
  await waitFor(() => expect(reads(HOLDERS)).toBe(2));
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  expect(chosen(CY)).toBe(COPY.NEW_MEMBER_NUMBERED(1));
  fireEvent.click(submitButton());
  await waitFor(() => expect(preparations()).toHaveLength(2));
  expect(preparations()[1]).toEqual(preparations()[0]);
});

it("shows another refused preparation's message without offering to reload the holders", async () => {
  prepareFor = async () => {
    throw refusal(400, ['A mapped wallet address already belongs to another member of this company.']);
  };
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(
    'A mapped wallet address already belongs to another member of this company.',
  );
  expect(screen.queryByText(COPY.HOLDINGS_MOVED)).toBeNull();
  expect(screen.queryByRole('button', { name: COPY.RELOAD_HOLDINGS })).toBeNull();
});

it('offers no reload for the holdings-moved sentence when the server did not refuse with 400', async () => {
  prepareFor = async () => {
    throw refusal(409, [MOVED]);
  };
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(MOVED);
  expect(screen.queryByRole('button', { name: COPY.RELOAD_HOLDINGS })).toBeNull();
});

it('clears a holdings-moved refusal once the draft changes', async () => {
  prepareFor = async () => {
    throw refusal(400, [MOVED]);
  };
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  await screen.findByText(COPY.HOLDINGS_MOVED);
  choose(DEE, 'Ada Member');
  expect(screen.queryByText(COPY.HOLDINGS_MOVED)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('refreshes the holders and appointments after a conflict and prepares the next attempt under a new operation', async () => {
  let conflict = true;
  prepareFor = async (body) => {
    if (conflict) throw refusal(409, { detail: 'The register operation conflicts.' });
    return { data: prepared(body) };
  };
  show();
  await ready();
  const before = [reads(HOLDERS), reads(APPOINTMENTS)];
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe('The register operation conflicts.');
  await waitFor(() => expect([reads(HOLDERS), reads(APPOINTMENTS)]).toEqual(before.map((count) => count + 1)));
  conflict = false;
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations().map((body) => body.operationId)).toEqual([KEY(5), KEY(6)]);
});

it('retries an identical preparation under the same operation and takes a new one when the mapping changes', async () => {
  prepareFor = async () => {
    throw Object.assign(new Error('Request timed out. Please check your connection and try again.'), {
      isUserFriendly: true,
    });
  };
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Request timed out. Please check your connection and try again.',
  );
  fireEvent.click(submitButton());
  await waitFor(() => expect(preparations()).toHaveLength(2));
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  choose(DEE, COPY.NEW_MEMBER_NUMBERED(2));
  expect(screen.queryByRole('alert')).toBeNull();
  prepareFor = async (body) => ({ data: prepared(body) });
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations().map((body) => [body.operationId, body.mapping[3].member])).toEqual([
    [KEY(5), KEY(3)],
    [KEY(5), KEY(3)],
    [KEY(6), KEY(2)],
  ]);
  expect(uploads()).toHaveLength(1);
});

it('refuses an unconfirmed preparation receipt and stays on the page with the cache unchanged', async () => {
  prepareFor = async (body) => ({ data: { ...prepared(body), mapping: [{ address: BO, member: MEMBER_ADA }] } });
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(COPY.PREPARATION_RECEIPT_FAILED);
  expect(client.getQueryState(OPENINGS_KEY)?.isInvalidated).toBe(false);
  expect(screen.queryByText('Register page')).toBeNull();
});

it('refuses an unconfirmed upload receipt, writes nothing and uploads that file again under a new key', async () => {
  uploadFor = async (form) => ({ data: { ...receipt(form), kind: 'share_register' } });
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(COPY.UPLOAD_RECEIPT_FAILED);
  expect(preparations()).toHaveLength(0);
  uploadFor = async (form) => ({ data: receipt(form) });
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => form.get('idempotency_key'))).toEqual([KEY(4), KEY(5)]);
  expect(preparations().map((body) => body.authorityEvidence)).toEqual([`evidence-${KEY(5)}`]);
});

it('reuses the retry key for an unconfirmed upload and a confirmed upload when the same opening is retried', async () => {
  let fail = true;
  uploadFor = async (form) => {
    if (fail) throw new Error('Network Error');
    return { data: receipt(form) };
  };
  prepareFor = async () => {
    throw Object.assign(new Error('Request timed out. Please check your connection and try again.'), {
      isUserFriendly: true,
    });
  };
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(
    'The opening could not be prepared. Retry with the same details.',
  );
  fail = false;
  fireEvent.click(submitButton());
  await waitFor(() => expect(preparations()).toHaveLength(1));
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  prepareFor = async (body) => ({ data: prepared(body) });
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => form.get('idempotency_key'))).toEqual([KEY(4), KEY(4)]);
  expect(preparations().map((body) => [body.operationId, body.authorityEvidence])).toEqual([
    [KEY(5), `evidence-${KEY(4)}`],
    [KEY(5), `evidence-${KEY(4)}`],
  ]);
});

it('takes a new upload key after the upload conflicts, or once another file is chosen', async () => {
  let conflict = true;
  uploadFor = async () => {
    if (conflict) throw refusal(409, { detail: 'The retry key was used for another upload.' });
    throw new Error('Network Error');
  };
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe('The retry key was used for another upload.');
  conflict = false;
  fireEvent.click(submitButton());
  await waitFor(() => expect(uploads()).toHaveLength(2));
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  uploadFor = async (form) => ({ data: receipt(form) });
  attach(new File(['%PDF court order'], 'court-order.pdf', { type: 'application/pdf' }));
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => [form.get('idempotency_key'), (form.get('file') as File).name])).toEqual([
    [KEY(4), 'signed-resolution.pdf'],
    [KEY(5), 'signed-resolution.pdf'],
    [KEY(6), 'court-order.pdf'],
  ]);
});

it('uploads again under a new key once another appointment holds the prepare step', async () => {
  let fail = true;
  uploadFor = async (form) => {
    if (fail) throw new Error('Network Error');
    return { data: receipt(form) };
  };
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  await screen.findByRole('alert');
  fail = false;
  appointments = [appointment(['prepare'], { uuid: 'appointment-0' })];
  await act(async () => {
    await client.refetchQueries({ queryKey: APPOINTMENTS_KEY });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => [form.get('idempotency_key'), form.get('appointment')])).toEqual([
    [KEY(4), 'appointment-a'],
    [KEY(5), 'appointment-0'],
  ]);
  expect(preparations()[0].appointment).toBe('appointment-0');
});

it('disables every field while the opening is being prepared', async () => {
  const pending = deferred<{ data: RegisterEvidence }>();
  uploadFor = () => pending.promise;
  show();
  await ready();
  complete();
  const fields = [
    screen.getByLabelText(COPY.AUTHORITY_DOCUMENT),
    screen.getByLabelText(COPY.AUTHORITY),
    screen.getByLabelText(COPY.APPROVING_DIRECTOR),
    screen.getByLabelText(COPY.AUTHORITY_REFERENCE),
    screen.getByLabelText(COPY.REASON),
    ...screen.getAllByLabelText(COPY.MEMBER),
  ];
  expect(fields.map((field) => field.matches(':disabled'))).toEqual(Array(8).fill(false));
  fireEvent.click(submitButton());
  await waitFor(() => expect(uploads()).toHaveLength(1));
  expect(fields.map((field) => field.matches(':disabled'))).toEqual(Array(8).fill(true));
  expect(submitButton().textContent).toBe('Preparing opening…');
  await act(async () => pending.resolve({ data: receipt(uploads()[0]) }));
  expect(await screen.findByText('Register page')).toBeTruthy();
});

it('prepares once when Prepare is pressed twice at once', async () => {
  show();
  await ready();
  complete();
  act(() => {
    submitButton().click();
    submitButton().click();
  });
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads()).toHaveLength(1);
  expect(preparations()).toHaveLength(1);
});

it('sends nothing further once the page closes while its upload is pending', async () => {
  const pending = deferred<{ data: RegisterEvidence }>();
  uploadFor = () => pending.promise;
  const view = show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  await waitFor(() => expect(uploads()).toHaveLength(1));
  view.unmount();
  await act(async () => pending.resolve({ data: receipt(uploads()[0]) }));
  expect(preparations()).toHaveLength(0);
  expect(client.getQueryState(OPENINGS_KEY)?.isInvalidated).toBe(false);
});

it('uploads nothing further and prepares nothing when an upload returns after the signed-in account changed', async () => {
  const pending = deferred<{ data: RegisterEvidence }>();
  uploadFor = () => pending.promise;
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  await waitFor(() => expect(uploads()).toHaveLength(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: receipt(uploads()[0]) }));
  expect(uploads()).toHaveLength(1);
  expect(preparations()).toHaveLength(0);
  expect(screen.queryByText('Register page')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('neither invalidates nor navigates when a preparation returns after the signed-in account changed', async () => {
  const pending = deferred<{ data: RegisterOpeningRecord }>();
  prepareFor = () => pending.promise;
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  await waitFor(() => expect(preparations()).toHaveLength(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: prepared(preparations()[0]) }));
  expect(client.getQueryState(OPENINGS_KEY)?.isInvalidated).toBe(false);
  expect(screen.queryByText('Register page')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps no holders whose read returns after the signed-in account changed', async () => {
  const pending = deferred<{ data: RegisterOpeningHolders }>();
  serve((url) => (url === HOLDERS ? pending.promise : undefined));
  show();
  await waitFor(() => expect(reads(HOLDERS)).toBe(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: holders() }));
  expect(client.getQueryData(HOLDERS_KEY)).toBeUndefined();
});

it('starts a blank draft for another signed-in account', async () => {
  show();
  await ready();
  complete();
  choose(CY, COPY.NEW_MEMBER_NUMBERED(1));
  act(switchAccount);
  await waitFor(() => expect((screen.getByLabelText(COPY.REASON) as HTMLTextAreaElement).value).toBe(''));
  expect(chosen(CY)).toBe(COPY.NEW_MEMBER_NUMBERED(2));
  expect(submitButton().disabled).toBe(true);
});

it('shows only the loading state while the appointments are read, then the form', async () => {
  const pending = deferred<ReturnType<typeof page<OwnCompanyAppointment>>>();
  serve((url) => (url === APPOINTMENTS ? pending.promise : undefined));
  show();
  await waitFor(() => expect(client.getQueryData([...ACCOUNT, 'classes'])).toEqual([LISTED]));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(screen.getByRole('status').textContent).toBe('Loading your register…');
  expect(screen.queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
  expect(reads(HOLDERS)).toBe(0);
  await act(async () => pending.resolve(page(appointments)));
  await ready();
  expect(screen.queryByRole('status')).toBeNull();
});

it('withdraws the form once a refresh shows the prepare appointment revoked', async () => {
  show();
  await ready();
  complete();
  appointments = [
    { ...appointment(['prepare']), status: 'revoked', isEffective: false, revokedAt: '2026-10-05T12:00:00Z' },
  ];
  await act(async () => {
    await client.refetchQueries({ queryKey: APPOINTMENTS_KEY });
  });
  expect(await screen.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(screen.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

it('withdraws the form once a reload finds the class already opened', async () => {
  show();
  await ready();
  serve((url) =>
    url === HOLDERS ? Promise.reject(refusal(400, ['This share class already has a stored register.'])) : undefined,
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: HOLDERS_KEY });
  });
  expect(await screen.findByText('This share class already has a stored register.')).toBeTruthy();
  expect(screen.queryByLabelText(COPY.AUTHORITY_DOCUMENT)).toBeNull();
});

it('keeps the draft but holds preparation after a failed chain refresh until a retry succeeds', async () => {
  show();
  await ready();
  complete();
  expect(submitButton().disabled).toBe(false);
  serve((url) => (url === HOLDERS ? Promise.reject(refusal(503, {})) : undefined));
  await act(async () => {
    await client.refetchQueries({ queryKey: HOLDERS_KEY });
  });
  expect((await screen.findByRole('alert')).textContent).toContain(COPY.HOLDERS_UNAVAILABLE);
  expect((screen.getByLabelText(COPY.REASON) as HTMLTextAreaElement).value).toBe(
    '  Open the register from the chain  ',
  );
  expect(submitButton().disabled).toBe(true);
  fireEvent.click(submitButton());
  fireEvent.submit(submitButton().closest('form')!);
  expect(api.post).not.toHaveBeenCalled();
  serve();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('holds preparation after a failed appointments refresh and says the register is incomplete', async () => {
  show();
  await ready();
  complete();
  serve((url) => (url === APPOINTMENTS ? Promise.reject(new Error('Unavailable')) : undefined));
  await act(async () => {
    await client.refetchQueries({ queryKey: APPOINTMENTS_KEY });
  });
  expect((await screen.findByRole('alert')).textContent).toContain("We couldn't load the complete register.");
  expect(submitButton().disabled).toBe(true);
});

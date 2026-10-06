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
  HOLDER_TYPE_LABELS,
  REGISTER_LINK_COPY,
  REGISTER_OPENING_COPY,
  USER_PREFERENCES_QUERY_KEY,
  type CompanyCapability,
  type OwnCompanyAppointment,
  type RegisterEvidence,
  type RegisterEvidenceKind,
  type RegisterLink,
  type RegisterLinkPreparation,
  type RegisterWaitingWallets,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { PageTitle } from '@components/PageTitle';
import apiClient from '@services/apiClient';
import CompanyRegisterLinksPage from '.';
import { LinkForm } from './LinkForm';
import { companyPreferences, prepareCompanyClient } from '../../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

const REGISTER = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const HOLDERS = COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary');
const EVIDENCE = COMPANY_TOKEN_ENDPOINTS.REGISTER_EVIDENCE;
const LINKS = COMPANY_TOKEN_ENDPOINTS.REGISTER_LINKS;
const WAITING = COMPANY_TOKEN_ENDPOINTS.REGISTER_LINK_WAITING_WALLETS;
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const ACCOUNT = ['tokens', 'register', 'profile-one', 'account-one'];
const LINKS_KEY = [...ACCOUNT, 'links', 'harbour'];
const WAITING_KEY = [...ACCOUNT, 'waiting-wallets', 'harbour'];
const HOLDERS_KEY = [...ACCOUNT, 'holders', 'ordinary'];
const APPOINTMENTS_KEY = ['company-appointments', 'profile-one', 'account-one'];
const COPY = REGISTER_LINK_COPY;
const NEW_MEMBER = REGISTER_OPENING_COPY.NEW_MEMBER_NUMBERED;
const KEY = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const RESOLUTION = new File(['%PDF signed resolution'], 'link-resolution.pdf', { type: 'application/pdf' });
const LISTED = {
  uuid: 'ordinary',
  companyUuid: 'harbour',
  companyName: 'Harbour Example Pty Ltd',
  name: 'Ordinary shares',
  symbol: 'ORD',
};
const ADA_WALLET = `0x${'a'.repeat(40)}`;
const BO_WALLET = `0x${'b'.repeat(40)}`;
const CY_WALLET = `0x${'c'.repeat(40)}`;
const DEE_WALLET = `0xD${'d'.repeat(39)}`;
const MEMBER_ADA = '10000000-0000-4000-8000-0000000000aa';
const MEMBER_UNNAMED = '10000000-0000-4000-8000-0000000000bb';
const REASON = 'Link the wallets of the September subscribers';
let client: QueryClient;
let appointments: OwnCompanyAppointment[];
let holders: TokenHoldersResponse['holders'];
let waitingWallets: RegisterWaitingWallets['wallets'];
let uploadFor: (form: FormData) => Promise<{ data: RegisterEvidence }>;
let prepareFor: (body: RegisterLinkPreparation) => Promise<{ data: RegisterLink }>;

function holder(member: string, name: string | null): TokenHoldersResponse['holders'][number] {
  return {
    member,
    name,
    holderType: name ? 'member' : 'unidentified',
    balance: '10',
    shareClass: 'ORD',
    source: 'register',
    identitySource: name ? 'particulars' : 'none',
    enteredOn: '2026-09-20',
    percentage: 50,
    wallets: [],
  };
}

function wallet(address: string, waiting = 1): RegisterWaitingWallets['wallets'][number] {
  return { address, waiting, walletProof: null, holderType: null, holderName: null };
}

const WAITING_WALLETS: RegisterWaitingWallets['wallets'] = [
  { address: ADA_WALLET, waiting: 2, walletProof: 'proven', holderType: 'member', holderName: 'Ada Member' },
  { address: BO_WALLET, waiting: 1, walletProof: 'not_proven', holderType: 'unidentified', holderName: null },
  wallet(CY_WALLET),
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

function prepared(body: RegisterLinkPreparation): RegisterLink {
  return {
    uuid: body.operationId,
    company: body.companyId,
    mapping: body.mapping,
    mappingSummary: body.mapping.map((row) => ({ ...row, memberExists: row.member === MEMBER_ADA })),
    authority: body.authority,
    approvingDirector: body.approvingDirector ?? '',
    authorityReference: body.authorityReference,
    reason: body.reason,
    sourceDocument: null,
    evidenceFingerprint: 'f'.repeat(64),
    evidenceSnapshot: { name: RESOLUTION.name },
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
    decisions: [],
    createdAt: '2026-10-05T03:00:00Z',
  };
}

function page<T>(results: T[]) {
  return { data: { results, count: results.length, next: null, previous: null } };
}

function registered(): TokenHoldersResponse {
  return {
    token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'deployed', totalSupply: '100' },
    initialized: true,
    issuedSupply: '20',
    waitingEffects: 4,
    holders,
    totalHolders: holders.length,
    formerMembers: [],
    formerMembersAsAt: null,
    formerMembersBlock: null,
    formerMembersStale: false,
  };
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
  return api.post.mock.calls.filter(([url]) => url === LINKS).map(([, body]) => body as RegisterLinkPreparation);
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
    if (url === HOLDERS) return { data: registered() };
    if (url === WAITING) return { data: { wallets: waitingWallets } };
    throw new Error(`Unexpected read ${url}`);
  });
}

function show() {
  prepareCompanyClient(client, 'company');
  client.setQueryData(['userAccount'], { data: { role: 'company' } });
  client.setQueryData(LINKS_KEY, []);
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient as unknown as AxiosInstance}>
        <MemoryRouter initialEntries={[DESTINATIONS.companyRegisterLinks.path.replace(':company', 'harbour')]}>
          <PageTitle.Provider value="Register">
            <Routes>
              <Route path={DESTINATIONS.companyRegisterLinks.path} element={<CompanyRegisterLinksPage />} />
              <Route path={DESTINATIONS.companyRegister.path} element={<p>Register page</p>} />
            </Routes>
          </PageTitle.Provider>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

function submitButton() {
  return screen.getByRole('button', { name: /Prepare wallet link|Preparing wallet link/ }) as HTMLButtonElement;
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function complete() {
  fireEvent.change(screen.getByLabelText(COPY.AUTHORITY_DOCUMENT), { target: { files: [RESOLUTION] } });
  fill(COPY.APPROVING_DIRECTOR, '  Example Director  ');
  fill(COPY.AUTHORITY_REFERENCE, 'RESOLUTION-LINK-1');
  fill(COPY.REASON, `  ${REASON}  `);
}

async function ready() {
  await screen.findByLabelText(COPY.AUTHORITY_DOCUMENT);
}

function memberOf(address: string) {
  return within(screen.getByRole('group', { name: address })).getByLabelText(COPY.MEMBER) as HTMLSelectElement;
}

function choose(address: string, label: string) {
  const select = memberOf(address);
  const option = [...select.options].find((item) => item.textContent === label)!;
  fireEvent.change(select, { target: { value: option.value } });
}

function chosen(...addresses: string[]) {
  return addresses.map((address) => {
    const select = memberOf(address);
    return select.options[select.selectedIndex].textContent;
  });
}

async function reread(queryKey: unknown[]) {
  await act(async () => {
    await client.refetchQueries({ queryKey });
  });
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let keys = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => KEY(++keys) as ReturnType<typeof crypto.randomUUID>);
  appointments = [appointment(['prepare'])];
  holders = [holder(MEMBER_ADA, 'Ada Member'), holder(MEMBER_UNNAMED, null)];
  waitingWallets = WAITING_WALLETS;
  uploadFor = async (form) => ({ data: receipt(form) });
  prepareFor = async (body) => ({ data: prepared(body) });
  serve();
  api.post.mockImplementation(async (url: string, body: unknown) => {
    if (url === EVIDENCE) return uploadFor(body as FormData);
    if (url === LINKS) return prepareFor(body as RegisterLinkPreparation);
    throw new Error(`Unexpected write ${url}`);
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('shows each waiting wallet, never pre-selects a member by name, and prepares exactly the mapping chosen', async () => {
  show();
  await ready();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Register');
  expect(screen.getByRole('heading', { level: 2, name: LISTED.companyName })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2, name: COPY.PREPARE })).toBeTruthy();
  for (const note of [COPY.APPLY_NOTE, COPY.MAPPING_NOTE, COPY.STATUS_NOTE, COPY.AUTHORITY_DOCUMENT_NOTE])
    expect(screen.getByText(note)).toBeTruthy();
  expect(
    [ADA_WALLET, BO_WALLET, CY_WALLET].map((address) =>
      [...screen.getByRole('group', { name: address }).querySelectorAll(':scope > p')].map((line) => line.textContent),
    ),
  ).toEqual([
    [COPY.WAITING(2), COPY.WALLET_PROOF.proven, `${COPY.HOLDER}: Ada Member`],
    [COPY.WAITING(1), COPY.WALLET_PROOF.not_proven, `${COPY.HOLDER}: ${HOLDER_TYPE_LABELS.unidentified}`],
    [COPY.WAITING(1), COPY.NO_STATUS],
  ]);
  expect(chosen(ADA_WALLET, BO_WALLET, CY_WALLET)).toEqual([NEW_MEMBER(1), NEW_MEMBER(2), NEW_MEMBER(3)]);
  expect([...memberOf(ADA_WALLET).options].map((option) => option.textContent)).toEqual([
    'Ada Member',
    `${COPY.UNNAMED_MEMBER} · ${COPY.HOLDING('10', 'ORD')}`,
    NEW_MEMBER(1),
    NEW_MEMBER(2),
    NEW_MEMBER(3),
  ]);
  choose(ADA_WALLET, 'Ada Member');
  choose(CY_WALLET, NEW_MEMBER(1));
  expect(chosen(ADA_WALLET, BO_WALLET, CY_WALLET)).toEqual(['Ada Member', NEW_MEMBER(1), NEW_MEMBER(1)]);
  expect(submitButton().disabled).toBe(true);
  complete();
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => Object.fromEntries(form.entries()))).toEqual([
    {
      company_id: 'harbour',
      appointment: 'appointment-a',
      kind: 'authority',
      idempotency_key: KEY(2),
      file: RESOLUTION,
    },
  ]);
  expect(preparations()).toEqual([
    {
      operationId: KEY(3),
      appointment: 'appointment-a',
      companyId: 'harbour',
      authorityEvidence: `evidence-${KEY(2)}`,
      mapping: [
        { address: ADA_WALLET, member: MEMBER_ADA },
        { address: BO_WALLET, member: KEY(1) },
        { address: CY_WALLET, member: KEY(1) },
      ],
      authority: 'director_resolution',
      approvingDirector: 'Example Director',
      authorityReference: 'RESOLUTION-LINK-1',
      reason: REASON,
    },
  ]);
  expect(api.post.mock.calls.find(([url]) => url === LINKS)?.[2]).toEqual({
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(client.getQueryState(LINKS_KEY)?.isInvalidated).toBe(true);
});

it('shows an appointee without a prepare capability the read-only note, no form and no waiting or register read', async () => {
  appointments = [appointment(['approve', 'apply'])];
  show();
  expect(await screen.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(screen.queryByLabelText(COPY.AUTHORITY_DOCUMENT)).toBeNull();
  expect([reads(WAITING), reads(HOLDERS)]).toEqual([0, 0]);
});

it('says nothing waits, and offers no form, when no wallet waits for a link', async () => {
  waitingWallets = [];
  show();
  expect(await screen.findByText(COPY.NOTHING_WAITING)).toBeTruthy();
  expect(screen.queryByLabelText(COPY.AUTHORITY_DOCUMENT)).toBeNull();
  expect(api.get).toHaveBeenCalledWith(WAITING, {
    params: { company: 'harbour' },
    ledovaSubmissionGuard: expect.any(Function),
  });
});

it('refuses an unconfirmed upload receipt, prepares nothing and uploads that file again under a new key', async () => {
  uploadFor = async (form) => ({ data: { ...receipt(form), kind: 'supporting' } });
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

it('retries an unconfirmed upload under the same key, and takes a new key once the upload conflicts', async () => {
  let failure: unknown = new Error('Network Error');
  uploadFor = async (form) => {
    if (failure) throw failure;
    return { data: receipt(form) };
  };
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  await screen.findByRole('alert');
  failure = refusal(409, { detail: 'The retry key was used for another upload.' });
  fireEvent.click(submitButton());
  await waitFor(() => expect(uploads()).toHaveLength(2));
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  failure = null;
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => form.get('idempotency_key'))).toEqual([KEY(4), KEY(4), KEY(5)]);
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
  await reread(APPOINTMENTS_KEY);
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => [form.get('appointment'), form.get('idempotency_key')])).toEqual([
    ['appointment-a', KEY(4)],
    ['appointment-0', KEY(5)],
  ]);
  expect(preparations()[0].appointment).toBe('appointment-0');
});

it('refuses an unconfirmed preparation receipt and stays on the page with the links as they were', async () => {
  prepareFor = async (body) => ({ data: { ...prepared(body), mapping: body.mapping.slice(1) } });
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(COPY.PREPARATION_RECEIPT_FAILED);
  expect(client.getQueryState(LINKS_KEY)?.isInvalidated).toBe(false);
  expect(screen.queryByText('Register page')).toBeNull();
});

it('retries an identical link under the same operation and upload, and takes a new operation once it differs', async () => {
  prepareFor = async () => {
    throw Object.assign(new Error('Request timed out. Please check your connection and try again.'), {
      isUserFriendly: true,
    });
  };
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  await screen.findByRole('alert');
  fireEvent.click(submitButton());
  await waitFor(() => expect(preparations()).toHaveLength(2));
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  choose(CY_WALLET, 'Ada Member');
  prepareFor = async (body) => ({ data: prepared(body) });
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations().map((body) => [body.operationId, body.authorityEvidence, body.mapping[2].member])).toEqual([
    [KEY(5), `evidence-${KEY(4)}`, KEY(3)],
    [KEY(5), `evidence-${KEY(4)}`, KEY(3)],
    [KEY(6), `evidence-${KEY(4)}`, MEMBER_ADA],
  ]);
  expect(uploads()).toHaveLength(1);
});

it('reads the waiting wallets, registers and appointments again after a conflict and prepares under a new operation', async () => {
  let conflict = true;
  prepareFor = async (body) => {
    if (conflict) throw refusal(409, { detail: 'The register operation conflicts.' });
    return { data: prepared(body) };
  };
  show();
  await ready();
  const before = [reads(WAITING), reads(HOLDERS), reads(APPOINTMENTS)];
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe('The register operation conflicts.');
  await waitFor(() =>
    expect([reads(WAITING), reads(HOLDERS), reads(APPOINTMENTS)]).toEqual(before.map((count) => count + 1)),
  );
  conflict = false;
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations().map((body) => body.operationId)).toEqual([KEY(5), KEY(6)]);
});

it("shows the server's words for a refused preparation, keeps the draft and reads the waiting wallets again", async () => {
  const words = 'A mapped wallet address is already linked to a member of this company.';
  prepareFor = async () => {
    throw refusal(400, [words]);
  };
  show();
  await ready();
  complete();
  choose(ADA_WALLET, 'Ada Member');
  const before = [reads(WAITING), reads(HOLDERS), reads(APPOINTMENTS)];
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(words);
  await waitFor(() =>
    expect([reads(WAITING), reads(HOLDERS), reads(APPOINTMENTS)]).toEqual([before[0] + 1, before[1] + 1, before[2]]),
  );
  expect((screen.getByLabelText(COPY.REASON) as HTMLTextAreaElement).value).toBe(`  ${REASON}  `);
  expect(chosen(ADA_WALLET)).toEqual(['Ada Member']);
});

it.each([
  [
    'preparation',
    () => {
      prepareFor = async () => {
        throw refusal(404, { detail: 'Company not found.' });
      };
    },
  ],
  ['the waiting wallets read', () => serve((url) => (url === WAITING ? Promise.reject(refusal(404, {})) : undefined))],
])(
  'reads the appointments again after %s is refused as not found, withdrawing the form once they are gone',
  async (refused, refuse) => {
    show();
    await ready();
    complete();
    const before = reads(APPOINTMENTS);
    appointments = [];
    refuse();
    if (refused === 'preparation') fireEvent.click(submitButton());
    else await reread(WAITING_KEY);
    expect(await screen.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
    expect(reads(APPOINTMENTS)).toBe(before + 1);
    expect(screen.queryByLabelText(COPY.AUTHORITY_DOCUMENT)).toBeNull();
  },
);

it('keeps each chosen member by its wallet across a re-read, in the order and numbering a link records', async () => {
  show();
  await ready();
  choose(ADA_WALLET, 'Ada Member');
  choose(CY_WALLET, NEW_MEMBER(1));
  waitingWallets = [wallet(CY_WALLET), wallet(DEE_WALLET), ...WAITING_WALLETS.slice(0, 2)];
  await reread(WAITING_KEY);
  await waitFor(() => expect(screen.getByRole('group', { name: DEE_WALLET })).toBeTruthy());
  expect(
    screen
      .getAllByRole('group')
      .map((group) => group.querySelector(':scope > legend')?.textContent)
      .filter((legend) => legend?.startsWith('0x')),
  ).toEqual([DEE_WALLET, ADA_WALLET, BO_WALLET, CY_WALLET]);
  expect(chosen(ADA_WALLET, BO_WALLET, CY_WALLET, DEE_WALLET)).toEqual([
    'Ada Member',
    NEW_MEMBER(2),
    NEW_MEMBER(2),
    NEW_MEMBER(1),
  ]);
  expect(screen.queryByText(COPY.CHOICES_RESET)).toBeNull();
  complete();
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  const mapping = Object.fromEntries(preparations()[0].mapping.map(({ address, member }) => [address, member]));
  expect([mapping[ADA_WALLET], mapping[CY_WALLET]]).toEqual([MEMBER_ADA, mapping[BO_WALLET]]);
  expect(mapping[DEE_WALLET]).not.toBe(mapping[BO_WALLET]);
});

it.each([
  ['its member no longer holds shares', HOLDERS_KEY, ADA_WALLET],
  ['the wallet whose new member it shares no longer waits', WAITING_KEY, CY_WALLET],
])('resets a choice when %s, and says so until a choice changes', async (_why, queryKey, address) => {
  show();
  await ready();
  choose(ADA_WALLET, 'Ada Member');
  choose(CY_WALLET, NEW_MEMBER(1));
  holders = [holder(MEMBER_UNNAMED, null)];
  waitingWallets = [WAITING_WALLETS[0], wallet(CY_WALLET)];
  await reread(queryKey);
  expect(await screen.findByText(COPY.CHOICES_RESET)).toBeTruthy();
  expect(memberOf(address).value).toBe(`new:${address}`);
  choose(address, chosen(address)[0]!);
  expect(screen.queryByText(COPY.CHOICES_RESET)).toBeNull();
});

it('neither refreshes nor returns to Register when a preparation returns after the signed-in account changed', async () => {
  const pending = deferred<{ data: RegisterLink }>();
  prepareFor = () => pending.promise;
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  await waitFor(() => expect(preparations()).toHaveLength(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: prepared(preparations()[0]) }));
  expect(client.getQueryState(LINKS_KEY)?.isInvalidated).toBe(false);
  expect(screen.queryByText('Register page')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('prepares nothing once its account guard refuses after an upload, even while the form stays open', async () => {
  const pending = deferred<{ data: RegisterEvidence }>();
  uploadFor = () => pending.promise;
  let current = true;
  const guard = () => {
    if (!current) throw new Error('Your signed-in account changed.');
  };
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LinkForm
          owner={{ userUuid: 'profile-one', ownerAccountUuid: 'account-one' }}
          guard={guard}
          company="harbour"
          wallets={WAITING_WALLETS}
          registers={[registered()]}
          appointment={appointment(['prepare'])}
          blocked={false}
          onRefused={() => undefined}
          onConflict={() => undefined}
          onMissing={() => undefined}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  complete();
  fireEvent.click(submitButton());
  await waitFor(() => expect(uploads()).toHaveLength(1));
  current = false;
  await act(async () => pending.resolve({ data: receipt(uploads()[0]) }));
  expect(preparations()).toHaveLength(0);
  expect(screen.queryByRole('alert')).toBeNull();
});

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
  REGISTER_IMPORT_COPY,
  USER_PREFERENCES_QUERY_KEY,
  type CompanyCapability,
  type OwnCompanyAppointment,
  type RegisterEvidence,
  type RegisterEvidenceKind,
  type RegisterImport,
  type RegisterImportPreparation,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { PageTitle } from '@components/PageTitle';
import apiClient from '@services/apiClient';
import CompanyRegisterImportPage from '.';
import { companyPreferences, prepareCompanyClient } from '../../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

const REGISTER = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const HOLDERS = COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary');
const EVIDENCE = COMPANY_TOKEN_ENDPOINTS.REGISTER_EVIDENCE;
const IMPORTS = COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORTS;
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const IMPORTS_KEY = ['tokens', 'register', 'profile-one', 'account-one', 'imports', 'ordinary'];
const COPY = REGISTER_IMPORT_COPY;
const KEY = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const REGISTER_FILE = new File(['%PDF members register'], 'members-register.pdf', { type: 'application/pdf' });
const ASIC_FILE = new File(['%PDF asic extract'], 'asic-extract.pdf', { type: 'application/pdf' });
let client: QueryClient;
let holders: TokenHoldersResponse;
let appointments: OwnCompanyAppointment[];
let uploadFor: (form: FormData) => Promise<{ data: RegisterEvidence }>;
let prepareFor: (body: RegisterImportPreparation) => Promise<{ data: RegisterImport }>;

function opened(): TokenHoldersResponse {
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

function unopened(): TokenHoldersResponse {
  return { ...opened(), initialized: false, issuedSupply: null, waitingEffects: null, holders: [], totalHolders: 0 };
}

function appointment(capabilities: CompanyCapability[]): OwnCompanyAppointment {
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

function prepared(body: RegisterImportPreparation): RegisterImport {
  return {
    uuid: body.operationId,
    company: 'harbour',
    token: body.tokenId,
    asAt: body.asAt,
    members: [...body.members]
      .sort((left, right) => left.member.localeCompare(right.member))
      .map(({ member, name, residentialAddress, shares, enteredOn, amountPaid }) => ({
        name,
        member,
        shares,
        enteredOn,
        amountPaid,
        residentialAddress,
      })),
    formerMembers: body.formerMembers.map(({ name, residentialAddress, shares, ceasedOn }) => ({
      name,
      shares,
      ceasedOn,
      residentialAddress,
    })),
    authority: body.authority,
    approvingDirector: body.approvingDirector ?? '',
    authorityReference: body.authorityReference,
    reason: body.reason,
    sourceDocument: null,
    evidenceFingerprint: 'f'.repeat(64),
    evidenceSnapshot: { name: REGISTER_FILE.name },
    asicDocument: null,
    asicFingerprint: 'f'.repeat(64),
    asicSnapshot: { name: ASIC_FILE.name },
    registerEvidence: body.registerEvidence,
    asicEvidence: body.asicEvidence,
    preparingAppointment: body.appointment,
    preparedByName: 'Example Preparer',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    asicIssuedTotal: body.asicIssuedTotal,
    asicMemberCount: body.asicMemberCount,
    registerSequence: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    createdAt: '2026-10-05T01:00:00Z',
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
  return api.post.mock.calls.filter(([url]) => url === IMPORTS).map(([, body]) => body as RegisterImportPreparation);
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
  client.setQueryData(IMPORTS_KEY, []);
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient as unknown as AxiosInstance}>
        <MemoryRouter initialEntries={['/company/register/ordinary/import']}>
          <PageTitle.Provider value="Register">
            <Routes>
              <Route path={DESTINATIONS.companyRegisterImport.path} element={<CompanyRegisterImportPage />} />
              <Route path={DESTINATIONS.companyRegister.path} element={<p>Register page</p>} />
            </Routes>
          </PageTitle.Provider>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

function submitButton() {
  return screen.getByRole('button', { name: /Prepare import|Preparing import/ }) as HTMLButtonElement;
}

function fill(label: string, value: string, scope: HTMLElement = document.body) {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
}

function attach(label: string, file: File) {
  fireEvent.change(screen.getByLabelText(label), { target: { files: [file] } });
}

function complete({ total = '9007199254740993', count = '1' } = {}) {
  attach('Current share register', REGISTER_FILE);
  attach('ASIC extract', ASIC_FILE);
  fill('Approving director', '  Example Director  ');
  fill('Authority reference', 'RESOLUTION-IMPORT-1');
  fill('Reason', "Import the company's register");
  const member = screen.getByRole('group', { name: 'Member 1' });
  fill('Residential address', ' 1 Example Street, Sydney NSW 2000 ', member);
  fill('Date entered', '2019-05-01', member);
  fill('Amount paid (optional)', '250.00', member);
  fill('Issued shares in the ASIC extract', total);
  fill('Members in the ASIC extract', count);
}

async function ready() {
  await screen.findByRole('group', { name: 'Member 1' });
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 5, 10, 0, 0));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let keys = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => KEY(++keys) as ReturnType<typeof crypto.randomUUID>);
  holders = opened();
  appointments = [appointment(['prepare'])];
  uploadFor = async (form) => ({ data: receipt(form) });
  prepareFor = async (body) => ({ data: prepared(body) });
  api.get.mockImplementation(async (url: string) => {
    if (url === REGISTER)
      return page([{ uuid: 'ordinary', companyUuid: 'harbour', companyName: 'Harbour Example Pty Ltd' }]);
    if (url === HOLDERS) return { data: holders };
    if (url === APPOINTMENTS) return page(appointments);
    throw new Error(`Unexpected read ${url}`);
  });
  api.post.mockImplementation(async (url: string, body: unknown) => {
    if (url === EVIDENCE) return uploadFor(body as FormData);
    if (url === IMPORTS) return prepareFor(body as RegisterImportPreparation);
    throw new Error(`Unexpected write ${url}`);
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('prepares an import of an opened class from its current members, uploading each file then the exact rows', async () => {
  show();
  await ready();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Register');
  expect(screen.getByRole('heading', { level: 2, name: 'Ordinary shares' })).toBeTruthy();
  expect(screen.getByText('Harbour Example Pty Ltd · ORD')).toBeTruthy();
  expect(screen.getByText('Opened')).toBeTruthy();
  const member = screen.getByRole('group', { name: 'Member 1' });
  expect(within(member).getByText('Example Member · 9,007,199,254,740,993 shares')).toBeTruthy();
  expect((within(member).getByLabelText('Name') as HTMLInputElement).value).toBe('Example Member');
  expect(within(member).queryByLabelText('Shares')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add a member' })).toBeNull();
  const asAt = screen.getByLabelText('Register date') as HTMLInputElement;
  expect([asAt.value, asAt.max]).toEqual(['2026-10-05', '2026-10-05']);
  expect(submitButton().disabled).toBe(true);

  complete();
  fireEvent.click(screen.getByRole('button', { name: 'Add a former member' }));
  const former = screen.getByRole('group', { name: 'Former member 1' });
  fill('Name', 'Example Former', former);
  fill('Residential address', '2 Example Road, Hobart TAS 7000', former);
  fill('Shares', '040', former);
  fill('Date ceased', '2022-03-01', former);
  expect(submitButton().disabled).toBe(false);
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();

  const sent = uploads();
  expect(sent.map((form) => Object.fromEntries(form.entries()))).toEqual([
    {
      company_id: 'harbour',
      appointment: 'appointment-a',
      kind: 'share_register',
      idempotency_key: KEY(2),
      file: REGISTER_FILE,
    },
    {
      company_id: 'harbour',
      appointment: 'appointment-a',
      kind: 'asic_extract',
      idempotency_key: KEY(3),
      file: ASIC_FILE,
    },
  ]);
  expect(api.post.mock.calls.filter(([url]) => url === EVIDENCE).map(([, , config]) => config)).toEqual([
    { ledovaSubmissionGuard: expect.any(Function), headers: { 'Content-Type': 'multipart/form-data' } },
    { ledovaSubmissionGuard: expect.any(Function), headers: { 'Content-Type': 'multipart/form-data' } },
  ]);
  expect(preparations()).toEqual([
    {
      operationId: KEY(4),
      appointment: 'appointment-a',
      tokenId: 'ordinary',
      registerEvidence: `evidence-${KEY(2)}`,
      asicEvidence: `evidence-${KEY(3)}`,
      asicIssuedTotal: '9007199254740993',
      asicMemberCount: 1,
      asAt: '2026-10-05',
      members: [
        {
          member: 'member-one',
          name: 'Example Member',
          residentialAddress: '1 Example Street, Sydney NSW 2000',
          shares: '9007199254740993',
          enteredOn: '2019-05-01',
          amountPaid: '250.00',
        },
      ],
      formerMembers: [
        {
          name: 'Example Former',
          residentialAddress: '2 Example Road, Hobart TAS 7000',
          shares: '40',
          ceasedOn: '2022-03-01',
        },
      ],
      authority: 'director_resolution',
      approvingDirector: 'Example Director',
      authorityReference: 'RESOLUTION-IMPORT-1',
      reason: "Import the company's register",
    },
  ]);
  expect(api.post.mock.calls.find(([url]) => url === IMPORTS)?.[2]).toEqual({
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(client.getQueryState(IMPORTS_KEY)?.isInvalidated).toBe(true);
});

it('opens a class not yet on chain from members it numbers itself, with editable shares', async () => {
  holders = unopened();
  show();
  await ready();
  expect(screen.getByText('Not opened')).toBeTruthy();
  expect(screen.getByText(COPY.NOT_ON_CHAIN_NOTE)).toBeTruthy();
  complete({ total: '150', count: '2' });
  fill('Shares', '0100', screen.getByRole('group', { name: 'Member 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add a member' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add a member' }));
  expect(screen.getByRole('group', { name: 'Member 3' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove member 2' }));
  expect(screen.queryByRole('group', { name: 'Member 3' })).toBeNull();
  const second = screen.getByRole('group', { name: 'Member 2' });
  fill('Name', 'Second Member', second);
  fill('Residential address', '3 Example Lane, Perth WA 6000', second);
  fill('Shares', '50', second);
  fill('Date entered', '2020-01-01', second);
  fill('Name', 'First Member', screen.getByRole('group', { name: 'Member 1' }));
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations()[0].members).toEqual([
    {
      member: KEY(1),
      name: 'First Member',
      residentialAddress: '1 Example Street, Sydney NSW 2000',
      shares: '100',
      enteredOn: '2019-05-01',
      amountPaid: '250.00',
    },
    {
      member: KEY(3),
      name: 'Second Member',
      residentialAddress: '3 Example Lane, Perth WA 6000',
      shares: '50',
      enteredOn: '2020-01-01',
      amountPaid: null,
    },
  ]);
  expect(preparations()[0]).toMatchObject({ asicIssuedTotal: '150', asicMemberCount: 2, formerMembers: [] });
});

it('blocks preparation while the stated ASIC figures differ from the import rows', async () => {
  show();
  await ready();
  complete({ total: '9007199254740992', count: '1' });
  expect(screen.getByText('Import rows: 9,007,199,254,740,993 shares held by 1 member')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('figures differ from the import rows');
  expect(submitButton().disabled).toBe(true);
  fireEvent.click(submitButton());
  fill('Issued shares in the ASIC extract', '9007199254740993');
  fill('Members in the ASIC extract', '2');
  expect(screen.getByRole('alert').textContent).toContain('figures differ from the import rows');
  expect(submitButton().disabled).toBe(true);
  fill('Members in the ASIC extract', '1');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(submitButton().disabled).toBe(false);
  expect(api.post).not.toHaveBeenCalled();
});

it('names an approving director only for a resolution and sends none for a court order', async () => {
  show();
  await ready();
  complete();
  fill('Approving director', '');
  expect(submitButton().disabled).toBe(true);
  expect(screen.getByText('Name the approving director for a resolution.')).toBeTruthy();
  fill('Approving director', 'Example Director');
  fireEvent.change(screen.getByLabelText('Authority'), { target: { value: 'court_order' } });
  expect(screen.queryByLabelText('Approving director')).toBeNull();
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations()[0]).toMatchObject({ authority: 'court_order', approvingDirector: '' });
});

it('keeps the register date and every row date from the future of the register', async () => {
  show();
  await ready();
  complete();
  fill('Register date', '2026-10-06');
  expect(screen.getByText('Enter a register date that is not in the future.')).toBeTruthy();
  expect(submitButton().disabled).toBe(true);
  fill('Register date', '2019-04-30');
  expect(screen.getByText(/a date entered no later than the register date/)).toBeTruthy();
  expect(submitButton().disabled).toBe(true);
  fill('Register date', '2026-09-30');
  fill('Amount paid (optional)', '250.001', screen.getByRole('group', { name: 'Member 1' }));
  expect(screen.getByText(/plain amount such as 250.00/)).toBeTruthy();
  expect(submitButton().disabled).toBe(true);
  fill('Amount paid (optional)', '', screen.getByRole('group', { name: 'Member 1' }));
  expect(submitButton().disabled).toBe(false);
});

it('shows an appointee without a prepare capability the read-only note, no form and no member read', async () => {
  appointments = [appointment(['approve', 'apply'])];
  show();
  expect(await screen.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Prepare import' })).toBeNull();
  expect(reads(HOLDERS)).toBe(0);
});

it('refuses an unconfirmed upload receipt, writes nothing and uploads that file again under a new key', async () => {
  uploadFor = async (form) => ({ data: { ...receipt(form), fileSize: 1 } });
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(COPY.UPLOAD_RECEIPT_FAILED);
  expect(preparations()).toHaveLength(0);
  expect(client.getQueryState(IMPORTS_KEY)?.isInvalidated).toBe(false);
  expect(screen.queryByText('Register page')).toBeNull();
  uploadFor = async (form) => ({ data: receipt(form) });
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => [form.get('kind'), form.get('idempotency_key')])).toEqual([
    ['share_register', KEY(1)],
    ['share_register', KEY(2)],
    ['asic_extract', KEY(3)],
  ]);
});

it('reuses a confirmed upload and the same retry key for an unconfirmed one when the same import is retried', async () => {
  let failAsic = true;
  uploadFor = async (form) => {
    if (form.get('kind') === 'asic_extract' && failAsic) throw new Error('Network Error');
    return { data: receipt(form) };
  };
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(
    'The import could not be prepared. Retry with the same details.',
  );
  failAsic = false;
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => [form.get('kind'), form.get('idempotency_key')])).toEqual([
    ['share_register', KEY(1)],
    ['asic_extract', KEY(2)],
    ['asic_extract', KEY(2)],
  ]);
  expect(preparations()).toHaveLength(1);
});

it('refuses an unconfirmed preparation receipt and stays on the page with the cache unchanged', async () => {
  prepareFor = async (body) => ({ data: { ...prepared(body), asicIssuedTotal: '1' } });
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(COPY.PREPARATION_RECEIPT_FAILED);
  expect(client.getQueryState(IMPORTS_KEY)?.isInvalidated).toBe(false);
  expect(screen.queryByText('Register page')).toBeNull();
  expect(preparations()).toHaveLength(1);
});

it('retries an identical preparation under the same operation and takes a new one when the request changes', async () => {
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
  fill('Reason', 'Import the corrected register');
  prepareFor = async (body) => ({ data: prepared(body) });
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations().map((body) => [body.operationId, body.reason])).toEqual([
    [KEY(3), "Import the company's register"],
    [KEY(3), "Import the company's register"],
    [KEY(4), 'Import the corrected register'],
  ]);
  expect(uploads()).toHaveLength(2);
});

it("shows the server's reason for a refused preparation", async () => {
  prepareFor = async () => {
    throw { response: { status: 400, data: ['The register date cannot be in the future.'] } };
  };
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe('The register date cannot be in the future.');
});

it('refreshes the class and appointments after a conflict and prepares the next attempt under a new operation', async () => {
  let conflict = true;
  prepareFor = async (body) => {
    if (conflict) throw { response: { status: 409, data: { detail: 'The register operation conflicts.' } } };
    return { data: prepared(body) };
  };
  show();
  await ready();
  const holdersRead = reads(HOLDERS);
  const appointmentsRead = reads(APPOINTMENTS);
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe('The register operation conflicts.');
  await waitFor(() => expect(reads(HOLDERS)).toBe(holdersRead + 1));
  expect(reads(APPOINTMENTS)).toBe(appointmentsRead + 1);
  conflict = false;
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations().map((body) => body.operationId)).toEqual([KEY(3), KEY(4)]);
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
  const pending = deferred<{ data: RegisterImport }>();
  prepareFor = () => pending.promise;
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  await waitFor(() => expect(preparations()).toHaveLength(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: prepared(preparations()[0]) }));
  expect(client.getQueryState(IMPORTS_KEY)?.isInvalidated).toBe(false);
  expect(screen.queryByText('Register page')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps the draft but holds preparation after a failed refresh until a retry succeeds', async () => {
  show();
  await ready();
  complete();
  expect(submitButton().disabled).toBe(false);
  api.get.mockImplementation(async (url: string) => {
    if (url === HOLDERS) throw new Error('Unavailable');
    if (url === APPOINTMENTS) return page(appointments);
    return page([{ uuid: 'ordinary', companyUuid: 'harbour', companyName: 'Harbour Example Pty Ltd' }]);
  });
  await act(async () => {
    await client.refetchQueries({ queryKey: ['tokens', 'register', 'profile-one', 'account-one', 'holders'] });
  });
  expect((await screen.findByRole('alert')).textContent).toContain("We couldn't load the complete register.");
  expect((screen.getByLabelText('Reason') as HTMLTextAreaElement).value).toBe("Import the company's register");
  expect(submitButton().disabled).toBe(true);
  fireEvent.click(submitButton());
  expect(api.post).not.toHaveBeenCalled();
  api.get.mockImplementation(async (url: string) => {
    if (url === HOLDERS) return { data: holders };
    if (url === APPOINTMENTS) return page(appointments);
    return page([{ uuid: 'ordinary', companyUuid: 'harbour', companyName: 'Harbour Example Pty Ltd' }]);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByLabelText('Reason') as HTMLTextAreaElement).value).toBe("Import the company's register");
});

it('takes a new upload key when another file is chosen after a failed attempt', async () => {
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
  const corrected = new File(['%PDF corrected register'], 'corrected-register.pdf', { type: 'application/pdf' });
  attach('Current share register', corrected);
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(
    uploads().map((form) => [form.get('kind'), form.get('idempotency_key'), (form.get('file') as File).name]),
  ).toEqual([
    ['share_register', KEY(1), 'members-register.pdf'],
    ['share_register', KEY(2), 'corrected-register.pdf'],
    ['asic_extract', KEY(3), 'asic-extract.pdf'],
  ]);
});

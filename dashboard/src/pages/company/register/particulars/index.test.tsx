// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  REGISTER_PARTICULARS_COPY,
  USER_PREFERENCES_QUERY_KEY,
  type CompanyCapability,
  type OwnCompanyAppointment,
  type RegisterEvidence,
  type RegisterEvidenceKind,
  type RegisterParticularsChange,
  type RegisterParticularsChangePreparation,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { PageTitle } from '@components/PageTitle';
import apiClient from '@services/apiClient';
import CompanyRegisterParticularsPage from '.';
import { ParticularsForm } from './ParticularsForm';
import { companyPreferences, prepareCompanyClient } from '../../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

const REGISTER = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const HOLDERS = COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary');
const EVIDENCE = COMPANY_TOKEN_ENDPOINTS.REGISTER_EVIDENCE;
const PARTICULARS = COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGES;
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const ACCOUNT = ['tokens', 'register', 'profile-one', 'account-one'];
const PARTICULARS_KEY = [...ACCOUNT, 'particulars', 'harbour'];
const HOLDERS_KEY = [...ACCOUNT, 'holders', 'ordinary'];
const APPOINTMENTS_KEY = ['company-appointments', 'profile-one', 'account-one'];
const COPY = REGISTER_PARTICULARS_COPY;
const KEY = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const MEMBER_ADA = '10000000-0000-4000-8000-0000000000aa';
const DEED = new File(['%PDF deed poll'], 'deed-poll.pdf', { type: 'application/pdf' });
const LISTED = {
  uuid: 'ordinary',
  companyUuid: 'harbour',
  companyName: 'Harbour Example Pty Ltd',
  name: 'Ordinary shares',
  symbol: 'ORD',
};
const REGISTERED = {
  token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'deployed', totalSupply: '100' },
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
} satisfies TokenHoldersResponse;
const DRAFT = {
  name: 'Ada Renamed',
  residentialAddress: '8 Synthetic Street, Melbourne VIC 3000',
  asAt: '2026-09-20',
  reason: 'Deed poll and a new address',
};
let client: QueryClient;
let appointments: OwnCompanyAppointment[];
let uploadFor: (form: FormData) => Promise<{ data: RegisterEvidence }>;
let prepareFor: (body: RegisterParticularsChangePreparation) => Promise<{ data: RegisterParticularsChange }>;

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

function prepared(body: RegisterParticularsChangePreparation): RegisterParticularsChange {
  return {
    uuid: body.operationId,
    company: 'harbour',
    member: body.member,
    name: body.name,
    residentialAddress: body.residentialAddress,
    asAt: body.asAt,
    reason: body.reason,
    evidenceFingerprint: 'f'.repeat(64),
    evidenceSnapshot: { name: DEED.name },
    supportingEvidence: body.supportingEvidence,
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
  return api.post.mock.calls
    .filter(([url]) => url === PARTICULARS)
    .map(([, body]) => body as RegisterParticularsChangePreparation);
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
    if (url === HOLDERS) return { data: REGISTERED };
    throw new Error(`Unexpected read ${url}`);
  });
}

function show(member = MEMBER_ADA) {
  prepareCompanyClient(client, 'company');
  client.setQueryData(['userAccount'], { data: { role: 'company' } });
  client.setQueryData(PARTICULARS_KEY, []);
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient as unknown as AxiosInstance}>
        <MemoryRouter initialEntries={[DESTINATIONS.companyRegisterParticulars.path.replace(':member', member)]}>
          <PageTitle.Provider value="Register">
            <Routes>
              <Route path={DESTINATIONS.companyRegisterParticulars.path} element={<CompanyRegisterParticularsPage />} />
              <Route path={DESTINATIONS.companyRegister.path} element={<p>Register page</p>} />
            </Routes>
          </PageTitle.Provider>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

function submitButton() {
  return screen.getByRole('button', { name: /Prepare change|Preparing change/ }) as HTMLButtonElement;
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function complete() {
  fireEvent.change(screen.getByLabelText(COPY.SUPPORTING_DOCUMENT), { target: { files: [DEED] } });
  fill(COPY.NAME, `  ${DRAFT.name}  `);
  fill(COPY.RESIDENTIAL_ADDRESS, `  ${DRAFT.residentialAddress}  `);
  fill(COPY.AS_AT, DRAFT.asAt);
  fill(COPY.REASON, `  ${DRAFT.reason}  `);
}

async function ready() {
  await screen.findByLabelText(COPY.SUPPORTING_DOCUMENT);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let keys = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => KEY(++keys) as ReturnType<typeof crypto.randomUUID>);
  appointments = [appointment(['prepare'])];
  uploadFor = async (form) => ({ data: receipt(form) });
  prepareFor = async (body) => ({ data: prepared(body) });
  serve();
  api.post.mockImplementation(async (url: string, body: unknown) => {
    if (url === EVIDENCE) return uploadFor(body as FormData);
    if (url === PARTICULARS) return prepareFor(body as RegisterParticularsChangePreparation);
    throw new Error(`Unexpected write ${url}`);
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it("shows the member's register name, then uploads the supporting document and prepares exactly that change", async () => {
  show();
  await ready();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Register');
  expect(screen.getByRole('heading', { level: 2, name: 'Ada Member' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2, name: COPY.PREPARE })).toBeTruthy();
  expect(screen.getByText(LISTED.companyName)).toBeTruthy();
  expect(screen.getByText(COPY.PRECEDENCE_NOTE)).toBeTruthy();
  complete();
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(
    uploads().map((form) => [
      form.get('company_id'),
      form.get('appointment'),
      form.get('kind'),
      form.get('idempotency_key'),
      form.get('file'),
    ]),
  ).toEqual([['harbour', 'appointment-a', 'supporting', KEY(1), DEED]]);
  expect(api.post).toHaveBeenCalledWith(
    PARTICULARS,
    {
      operationId: KEY(2),
      appointment: 'appointment-a',
      member: MEMBER_ADA,
      supportingEvidence: `evidence-${KEY(1)}`,
      ...DRAFT,
    },
    { ledovaSubmissionGuard: expect.any(Function) },
  );
  expect(client.getQueryState(PARTICULARS_KEY)?.isInvalidated).toBe(true);
});

it('holds preparation until every field is given and the as-at date is no later than today in UTC', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  show();
  await ready();
  expect((screen.getByLabelText(COPY.AS_AT) as HTMLInputElement).value).toBe(today);
  expect(submitButton().disabled).toBe(true);
  complete();
  expect(submitButton().disabled).toBe(false);
  fill(COPY.AS_AT, tomorrow);
  expect(submitButton().disabled).toBe(true);
  fill(COPY.AS_AT, today);
  fill(COPY.REASON, '   ');
  expect(submitButton().disabled).toBe(true);
  fireEvent.submit(submitButton().closest('form')!);
  expect(api.post).not.toHaveBeenCalled();
});

it('refuses an unconfirmed upload receipt, prepares nothing and uploads that file again under a new key', async () => {
  uploadFor = async (form) => ({ data: { ...receipt(form), kind: 'authority' } });
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(COPY.UPLOAD_RECEIPT_FAILED);
  expect(preparations()).toHaveLength(0);
  uploadFor = async (form) => ({ data: receipt(form) });
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => form.get('idempotency_key'))).toEqual([KEY(1), KEY(2)]);
  expect(preparations().map((body) => body.supportingEvidence)).toEqual([`evidence-${KEY(2)}`]);
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
  expect(uploads().map((form) => form.get('idempotency_key'))).toEqual([KEY(1), KEY(1), KEY(2)]);
  expect(preparations().map((body) => body.supportingEvidence)).toEqual([`evidence-${KEY(2)}`]);
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
  expect(uploads().map((form) => [form.get('appointment'), form.get('idempotency_key')])).toEqual([
    ['appointment-a', KEY(1)],
    ['appointment-0', KEY(2)],
  ]);
  expect(preparations()[0].appointment).toBe('appointment-0');
});

it('refuses an unconfirmed preparation receipt and stays on the page with the changes as they were', async () => {
  prepareFor = async (body) => ({ data: { ...prepared(body), asAt: '2026-09-21' } });
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(COPY.PREPARATION_RECEIPT_FAILED);
  expect(client.getQueryState(PARTICULARS_KEY)?.isInvalidated).toBe(false);
  expect(screen.queryByText('Register page')).toBeNull();
});

it('retries an identical change under the same operation and upload, and takes a new operation once it differs', async () => {
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
  fill(COPY.REASON, 'A member notice of a new address');
  prepareFor = async (body) => ({ data: prepared(body) });
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations().map((body) => [body.operationId, body.supportingEvidence, body.reason])).toEqual([
    [KEY(2), `evidence-${KEY(1)}`, DRAFT.reason],
    [KEY(2), `evidence-${KEY(1)}`, DRAFT.reason],
    [KEY(3), `evidence-${KEY(1)}`, 'A member notice of a new address'],
  ]);
  expect(uploads()).toHaveLength(1);
});

it("reads the member's register and appointments again after a conflict and prepares under a new operation", async () => {
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
  expect(preparations().map((body) => body.operationId)).toEqual([KEY(2), KEY(3)]);
});

it("shows the server's words for a refused preparation and keeps the draft", async () => {
  const words =
    "The register already records this member's particulars as at 2026-09-30, after 2026-09-20. Date the change on " +
    'or after 2026-09-30, or keep the later particulars.';
  prepareFor = async () => {
    throw refusal(400, [words]);
  };
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(words);
  expect((screen.getByLabelText(COPY.NAME) as HTMLInputElement).value).toBe(`  ${DRAFT.name}  `);
});

it('reads the appointments again after preparation is refused as not found, withdrawing the form once they are gone', async () => {
  prepareFor = async () => {
    throw refusal(404, { detail: 'Register member not found.' });
  };
  show();
  await ready();
  complete();
  const before = reads(APPOINTMENTS);
  appointments = [];
  fireEvent.click(submitButton());
  expect(await screen.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(reads(APPOINTMENTS)).toBe(before + 1);
  expect(screen.queryByLabelText(COPY.SUPPORTING_DOCUMENT)).toBeNull();
});

it('holds preparation after a failed appointments refresh', async () => {
  show();
  await ready();
  complete();
  expect(submitButton().disabled).toBe(false);
  serve((url) => (url === APPOINTMENTS ? Promise.reject(new Error('Unavailable')) : undefined));
  await act(async () => {
    await client.refetchQueries({ queryKey: APPOINTMENTS_KEY });
  });
  await waitFor(() => expect(submitButton().disabled).toBe(true));
  fireEvent.submit(submitButton().closest('form')!);
  expect(api.post).not.toHaveBeenCalled();
});

it("prepares while another company's register cannot be read", async () => {
  const inland = { ...LISTED, uuid: 'preference', companyUuid: 'inland', companyName: 'Inland Example Pty Ltd' };
  appointments = [
    appointment(['prepare']),
    appointment(['prepare'], { uuid: 'appointment-b', company: 'inland', companyName: inland.companyName }),
  ];
  serve((url) => {
    if (url === REGISTER) return page([LISTED, inland]);
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference')) return Promise.reject(new Error('Unavailable'));
    return undefined;
  });
  show();
  await ready();
  await waitFor(() => expect(client.getQueryState([...ACCOUNT, 'holders', 'preference'])?.status).toBe('error'));
  complete();
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations()[0].appointment).toBe('appointment-a');
});

it('shows an appointee without a prepare capability the read-only note, no form and no register read', async () => {
  appointments = [appointment(['approve', 'apply'])];
  show();
  expect(await screen.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(screen.queryByLabelText(COPY.SUPPORTING_DOCUMENT)).toBeNull();
  expect(reads(HOLDERS)).toBe(0);
});

it('offers no form for a member who is not on a register the appointee can change', async () => {
  show('10000000-0000-4000-8000-0000000000ff');
  await waitFor(() => expect(reads(HOLDERS)).toBe(1));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(screen.queryByLabelText(COPY.SUPPORTING_DOCUMENT)).toBeNull();
  expect(screen.queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
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
  expect(screen.queryByRole('alert')).toBeNull();
});

it('neither refreshes nor returns to Register when a preparation returns after the signed-in account changed', async () => {
  const pending = deferred<{ data: RegisterParticularsChange }>();
  prepareFor = () => pending.promise;
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  await waitFor(() => expect(preparations()).toHaveLength(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: prepared(preparations()[0]) }));
  expect(client.getQueryState(PARTICULARS_KEY)?.isInvalidated).toBe(false);
  expect(screen.queryByText('Register page')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('reads nothing again for the previous account when a conflict returns after the signed-in account changed', async () => {
  let refuse!: (failure: unknown) => void;
  prepareFor = () =>
    new Promise((_resolve, reject) => {
      refuse = reject;
    });
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  await waitFor(() => expect(preparations()).toHaveLength(1));
  appointments = [];
  act(switchAccount);
  expect(await screen.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  const before = [reads(HOLDERS), reads(APPOINTMENTS), client.getQueryState(HOLDERS_KEY)?.dataUpdatedAt];
  await act(async () => {
    refuse(refusal(409, { detail: 'The register operation conflicts.' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect([reads(HOLDERS), reads(APPOINTMENTS), client.getQueryState(HOLDERS_KEY)?.dataUpdatedAt]).toEqual(before);
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
        <ParticularsForm
          owner={{ userUuid: 'profile-one', ownerAccountUuid: 'account-one' }}
          guard={guard}
          company="harbour"
          member={MEMBER_ADA}
          appointment={appointment(['prepare'])}
          blocked={false}
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

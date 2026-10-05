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
  REGISTER_CORRECTION_COPY,
  USER_PREFERENCES_QUERY_KEY,
  type CompanyCapability,
  type OwnCompanyAppointment,
  type RegisterCorrection,
  type RegisterCorrectionPreparation,
  type RegisterEntry,
  type RegisterEvidence,
  type RegisterEvidenceKind,
} from '@ledova/shared';
import { PageTitle } from '@components/PageTitle';
import apiClient from '@services/apiClient';
import CompanyRegisterCorrectionPage from '.';
import { companyPreferences, prepareCompanyClient } from '../../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

const REGISTER = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const ENTRIES = COMPANY_TOKEN_ENDPOINTS.REGISTER_ENTRIES('ordinary');
const EVIDENCE = COMPANY_TOKEN_ENDPOINTS.REGISTER_EVIDENCE;
const CORRECTIONS = COMPANY_TOKEN_ENDPOINTS.REGISTER_CORRECTIONS;
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const ACCOUNT = ['tokens', 'register', 'profile-one', 'account-one'];
const CORRECTIONS_KEY = [...ACCOUNT, 'corrections', 'ordinary'];
const ENTRY_KEY = [...ACCOUNT, 'entries', 'ordinary', 'entry-transfer'];
const COPY = REGISTER_CORRECTION_COPY;
const KEY = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const NEXT = (page: number) => `https://example.test/tokens/ordinary/register/entries/?page=${page}`;
const AUTHORITY_FILE = new File(['%PDF signed resolution'], 'signed-resolution.pdf', { type: 'application/pdf' });
const LISTED = {
  uuid: 'ordinary',
  companyUuid: 'harbour',
  companyName: 'Harbour Example Pty Ltd',
  name: 'Ordinary shares',
  symbol: 'ORD',
};
let client: QueryClient;
let appointments: OwnCompanyAppointment[];
let entryPages: ReturnType<typeof page<RegisterEntry>>[];
let uploadFor: (form: FormData) => Promise<{ data: RegisterEvidence }>;
let prepareFor: (body: RegisterCorrectionPreparation) => Promise<{ data: RegisterCorrection }>;

function entry(overrides: Partial<RegisterEntry> = {}): RegisterEntry {
  return {
    uuid: 'entry-transfer',
    sequence: 7,
    kind: 'transfer',
    effectiveOn: '2026-09-15',
    recordedAt: '2026-09-15T02:00:00Z',
    changes: [
      { member: 'member-one', name: 'Example Member', shares: '-9007199254740993' },
      { member: 'member-two', name: null, shares: '9007199254740993' },
    ],
    corrects: null,
    correctedBy: null,
    correctable: true,
    ...overrides,
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

function prepared(body: RegisterCorrectionPreparation): RegisterCorrection {
  return {
    uuid: body.operationId,
    company: 'harbour',
    register: 'register-ordinary',
    corrects: body.correctsId,
    baseSequence: 9,
    baseHash: 'f'.repeat(64),
    effectiveOn: body.effectiveOn,
    changes: [
      { member: 'member-one', shares: '9007199254740993' },
      { member: 'member-two', shares: '-9007199254740993' },
    ],
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

function uploads() {
  return api.post.mock.calls.filter(([url]) => url === EVIDENCE).map(([, form]) => form as FormData);
}

function preparations() {
  return api.post.mock.calls
    .filter(([url]) => url === CORRECTIONS)
    .map(([, body]) => body as RegisterCorrectionPreparation);
}

function switchAccount() {
  const other = companyPreferences('company');
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { ...other, userProfile: 'profile-two', userAccount: { ...other.userAccount!, uuid: 'account-two' } },
  });
}

function serve(entries = entryPages) {
  api.get.mockImplementation(async (url: string, config?: { params?: { entry?: string[] } }) => {
    if (url === REGISTER) return page([LISTED]);
    if (url === APPOINTMENTS) return page(appointments);
    if (url === ENTRIES)
      return page(
        entries.flatMap(({ data }) => data.results).filter(({ uuid }) => config?.params?.entry?.includes(uuid)),
      );
    throw new Error(`Unexpected read ${url}`);
  });
}

function show() {
  prepareCompanyClient(client, 'company');
  client.setQueryData(['userAccount'], { data: { role: 'company' } });
  client.setQueryData(CORRECTIONS_KEY, []);
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient as unknown as AxiosInstance}>
        <MemoryRouter initialEntries={['/company/register/ordinary/correct/entry-transfer']}>
          <PageTitle.Provider value="Register">
            <Routes>
              <Route path={DESTINATIONS.companyRegisterCorrection.path} element={<CompanyRegisterCorrectionPage />} />
              <Route path={DESTINATIONS.companyRegister.path} element={<p>Register page</p>} />
            </Routes>
          </PageTitle.Provider>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

function submitButton() {
  return screen.getByRole('button', { name: /Prepare correction|Preparing correction/ }) as HTMLButtonElement;
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
  fill(COPY.AUTHORITY_REFERENCE, 'RESOLUTION-CORRECTION-1');
  fill(COPY.REASON, '  Reverse the transfer recorded in error  ');
}

async function ready() {
  await screen.findByLabelText(COPY.AUTHORITY_DOCUMENT);
}

function lines(term: HTMLElement) {
  return [...term.nextElementSibling!.children].map((line) => line.textContent);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  vi.stubEnv('TZ', 'Pacific/Kiritimati');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 5, 12, 30)));
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let keys = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => KEY(++keys) as ReturnType<typeof crypto.randomUUID>);
  appointments = [appointment(['prepare'])];
  entryPages = [
    page([entry({ uuid: 'entry-newer', sequence: 8, kind: 'issue' })], NEXT(2)),
    page([entry()], NEXT(3)),
    page([entry({ uuid: 'entry-older', sequence: 6 })]),
  ];
  uploadFor = async (form) => ({ data: receipt(form) });
  prepareFor = async (body) => ({ data: prepared(body) });
  serve();
  api.post.mockImplementation(async (url: string, body: unknown) => {
    if (url === EVIDENCE) return uploadFor(body as FormData);
    if (url === CORRECTIONS) return prepareFor(body as RegisterCorrectionPreparation);
    throw new Error(`Unexpected write ${url}`);
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('shows the entry and its exact inverse, then uploads the authority document and prepares exactly that request', async () => {
  show();
  await ready();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Register');
  expect(screen.getByRole('heading', { level: 2, name: 'Ordinary shares' })).toBeTruthy();
  expect(screen.getByText('Harbour Example Pty Ltd · ORD')).toBeTruthy();
  expect(lines(screen.getByText(COPY.ORIGINAL_CHANGES))).toEqual([
    'Transfer · Entry 7 · Effective 2026-09-15',
    'Example Member: -9,007,199,254,740,993',
    `${COPY.UNNAMED_MEMBER('member-two')}: +9,007,199,254,740,993`,
  ]);
  expect(lines(screen.getByText(COPY.COMPENSATING_CHANGES))).toEqual([
    'Example Member: +9,007,199,254,740,993',
    `${COPY.UNNAMED_MEMBER('member-two')}: -9,007,199,254,740,993`,
  ]);
  expect(screen.getByText(COPY.COMPENSATION_NOTE)).toBeTruthy();
  expect(screen.getByText(COPY.AUTHORITY_DOCUMENT_NOTE)).toBeTruthy();
  expect(
    [COPY.APPROVING_DIRECTOR, COPY.AUTHORITY_REFERENCE, COPY.REASON].map(
      (label) => (screen.getByLabelText(label) as HTMLInputElement).maxLength,
    ),
  ).toEqual([255, 255, 1000]);
  expect(api.get.mock.calls.filter(([url]) => url === ENTRIES).map(([, config]) => config)).toEqual([
    {
      params: { entry: ['entry-transfer'], page: 1 },
      paramsSerializer: { indexes: null },
      ledovaSubmissionGuard: expect.any(Function),
    },
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
      idempotency_key: KEY(1),
      file: AUTHORITY_FILE,
    },
  ]);
  expect(api.post.mock.calls.find(([url]) => url === EVIDENCE)?.[2]).toEqual({
    ledovaSubmissionGuard: expect.any(Function),
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  expect(preparations()).toEqual([
    {
      operationId: KEY(2),
      appointment: 'appointment-a',
      correctsId: 'entry-transfer',
      authorityEvidence: `evidence-${KEY(1)}`,
      effectiveOn: '2026-10-05',
      authority: 'director_resolution',
      approvingDirector: 'Example Director',
      authorityReference: 'RESOLUTION-CORRECTION-1',
      reason: 'Reverse the transfer recorded in error',
    },
  ]);
  expect(api.post.mock.calls.find(([url]) => url === CORRECTIONS)?.[2]).toEqual({
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(client.getQueryState(CORRECTIONS_KEY)?.isInvalidated).toBe(true);
});

it('defaults the effective date to today in UTC and refuses a later one, but takes an earlier one', async () => {
  show();
  await ready();
  const effective = screen.getByLabelText(COPY.EFFECTIVE_ON) as HTMLInputElement;
  expect([effective.value, effective.max]).toEqual(['2026-10-05', '2026-10-05']);
  expect(screen.getByText(COPY.EFFECTIVE_ON_NOTE)).toBeTruthy();
  complete();
  fill(COPY.EFFECTIVE_ON, '2026-10-06');
  expect(screen.getByText('Enter an effective date no later than today (UTC).')).toBeTruthy();
  expect(submitButton().disabled).toBe(true);
  fill(COPY.EFFECTIVE_ON, '');
  expect(submitButton().disabled).toBe(true);
  fill(COPY.EFFECTIVE_ON, '2026-09-20');
  expect(screen.queryByText('Enter an effective date no later than today (UTC).')).toBeNull();
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations()[0].effectiveOn).toBe('2026-09-20');
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
  complete();
  fill(COPY.AUTHORITY_REFERENCE, ' ');
  expect(screen.getByText('Give the authority reference and the reason.')).toBeTruthy();
  expect(submitButton().disabled).toBe(true);
  fill(COPY.AUTHORITY_REFERENCE, 'RESOLUTION-CORRECTION-1');
  fill(COPY.REASON, ' ');
  expect(submitButton().disabled).toBe(true);
  fill(COPY.REASON, 'Reverse the transfer recorded in error');
  fireEvent.change(screen.getByLabelText(COPY.AUTHORITY_DOCUMENT), { target: { files: [] } });
  expect(screen.getByText('Choose the authority document.')).toBeTruthy();
  expect(submitButton().disabled).toBe(true);
  fireEvent.click(submitButton());
  expect(api.post).not.toHaveBeenCalled();
});

it('shows an appointee without a prepare capability the read-only note, no form and no entry read', async () => {
  appointments = [appointment(['approve', 'apply', 'read_register'])];
  show();
  expect(await screen.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(screen.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
  expect(reads(ENTRIES)).toBe(0);
});

it('withdraws the form once a refresh shows the prepare appointment revoked', async () => {
  show();
  await ready();
  complete();
  appointments = [
    { ...appointment(['prepare']), status: 'revoked', isEffective: false, revokedAt: '2026-10-05T12:00:00Z' },
  ];
  await act(async () => {
    await client.refetchQueries({ queryKey: ['company-appointments', 'profile-one', 'account-one'] });
  });
  expect(await screen.findByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(screen.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

it('says when the share class is not in a register the person can read', async () => {
  api.get.mockImplementation(async (url: string) => {
    if (url === REGISTER) return page([]);
    if (url === APPOINTMENTS) return page(appointments);
    throw new Error(`Unexpected read ${url}`);
  });
  show();
  expect(await screen.findByText('This share class is not in a register you can read.')).toBeTruthy();
  expect(reads(ENTRIES)).toBe(0);
});

it("says when the class's register returns no entry by that UUID", async () => {
  entryPages = [page([entry({ uuid: 'entry-newer' })], NEXT(2)), page([entry({ uuid: 'entry-older' })])];
  serve();
  show();
  expect(await screen.findByText('This entry is not in the register of this share class.')).toBeTruthy();
  expect(reads(ENTRIES)).toBe(1);
  expect(screen.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
});

it.each<[string, Partial<RegisterEntry>, string]>([
  ['a correction has reversed it', { correctable: false, correctedBy: 'entry-correction' }, COPY.CORRECTED_NOTE],
  [
    'it records no change',
    { correctable: false, changes: [] },
    'This entry records no change, so there is nothing to correct.',
  ],
])('offers no correction of an entry when %s', async (_why, overrides, note) => {
  entryPages = [page([entry(overrides)])];
  serve();
  show();
  expect(await screen.findByText(note)).toBeTruthy();
  expect(screen.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
});

it('refuses an entry whose changes are not exact share counts', async () => {
  entryPages = [page([entry({ changes: [{ member: 'member-one', name: 'Example Member', shares: '1.5' }] })])];
  serve();
  show();
  expect((await screen.findByRole('alert')).textContent).toContain("We couldn't load the complete register.");
  expect(screen.queryByText('Example Member: +1.5')).toBeNull();
  expect(screen.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
});

it('refuses an unconfirmed upload receipt, writes nothing and uploads that file again under a new key', async () => {
  uploadFor = async (form) => ({ data: { ...receipt(form), kind: 'share_register' } });
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(COPY.UPLOAD_RECEIPT_FAILED);
  expect(preparations()).toHaveLength(0);
  expect(client.getQueryState(CORRECTIONS_KEY)?.isInvalidated).toBe(false);
  uploadFor = async (form) => ({ data: receipt(form) });
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => form.get('idempotency_key'))).toEqual([KEY(1), KEY(2)]);
  expect(preparations().map((body) => body.authorityEvidence)).toEqual([`evidence-${KEY(2)}`]);
});

it('reuses the retry key for an unconfirmed upload and a confirmed upload when the same correction is retried', async () => {
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
    'The correction could not be prepared. Retry with the same details.',
  );
  fail = false;
  fireEvent.click(submitButton());
  await waitFor(() => expect(preparations()).toHaveLength(1));
  await waitFor(() => expect(submitButton().disabled).toBe(false));
  prepareFor = async (body) => ({ data: prepared(body) });
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => form.get('idempotency_key'))).toEqual([KEY(1), KEY(1)]);
  expect(preparations().map((body) => [body.operationId, body.authorityEvidence])).toEqual([
    [KEY(2), `evidence-${KEY(1)}`],
    [KEY(2), `evidence-${KEY(1)}`],
  ]);
});

it('takes a new upload key after the upload conflicts', async () => {
  let conflict = true;
  uploadFor = async (form) => {
    if (conflict) throw { response: { status: 409, data: { detail: 'The retry key was used for another upload.' } } };
    return { data: receipt(form) };
  };
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe('The retry key was used for another upload.');
  conflict = false;
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => form.get('idempotency_key'))).toEqual([KEY(1), KEY(2)]);
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
    await client.refetchQueries({ queryKey: ['company-appointments', 'profile-one', 'account-one'] });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => [form.get('idempotency_key'), form.get('appointment')])).toEqual([
    [KEY(1), 'appointment-a'],
    [KEY(2), 'appointment-0'],
  ]);
  expect(preparations()[0].appointment).toBe('appointment-0');
});

it('refuses a lookup that answers with an entry it was not asked for', async () => {
  const read = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string, config?: unknown) =>
    url === ENTRIES ? page([entry({ uuid: 'entry-newer' })]) : read(url, config),
  );
  show();
  expect((await screen.findByRole('alert')).textContent).toContain("We couldn't load the complete register.");
  expect(screen.queryByText('This entry is not in the register of this share class.')).toBeNull();
  expect(screen.queryByText(COPY.ORIGINAL_CHANGES)).toBeNull();
  expect(screen.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
});

it('shows only the loading state while the appointments are read, then the form', async () => {
  const pending = deferred<ReturnType<typeof page<OwnCompanyAppointment>>>();
  const read = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string, config?: unknown) =>
    url === APPOINTMENTS ? pending.promise : read(url, config),
  );
  show();
  await waitFor(() => expect(client.getQueryData([...ACCOUNT, 'classes'])).toEqual([LISTED]));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(screen.getByRole('status').textContent).toBe('Loading your register…');
  expect(screen.queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(reads(ENTRIES)).toBe(0);
  await act(async () => pending.resolve(page(appointments)));
  await ready();
  expect(screen.queryByRole('status')).toBeNull();
});

it('disables every field while the correction is being prepared', async () => {
  const pending = deferred<{ data: RegisterEvidence }>();
  uploadFor = () => pending.promise;
  show();
  await ready();
  complete();
  const fields = [
    COPY.AUTHORITY_DOCUMENT,
    COPY.EFFECTIVE_ON,
    COPY.AUTHORITY,
    COPY.APPROVING_DIRECTOR,
    COPY.AUTHORITY_REFERENCE,
    COPY.REASON,
  ].map((label) => screen.getByLabelText(label));
  expect(fields.map((field) => field.matches(':disabled'))).toEqual(Array(6).fill(false));
  fireEvent.click(submitButton());
  await waitFor(() => expect(uploads()).toHaveLength(1));
  expect(fields.map((field) => field.matches(':disabled'))).toEqual(Array(6).fill(true));
  await act(async () => pending.resolve({ data: receipt(uploads()[0]) }));
  expect(await screen.findByText('Register page')).toBeTruthy();
});

it('refuses a named entry read whose next link does not advance', async () => {
  const read = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string, config?: unknown) =>
    url === ENTRIES ? page([], NEXT(1)) : read(url, config),
  );
  show();
  expect((await screen.findByRole('alert')).textContent).toContain("We couldn't load the complete register.");
  expect(reads(ENTRIES)).toBe(1);
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
  const corrected = new File(['%PDF court order'], 'court-order.pdf', { type: 'application/pdf' });
  attach(corrected);
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(uploads().map((form) => [form.get('idempotency_key'), (form.get('file') as File).name])).toEqual([
    [KEY(1), 'signed-resolution.pdf'],
    [KEY(2), 'court-order.pdf'],
  ]);
});

it('refuses an unconfirmed preparation receipt and stays on the page with the cache unchanged', async () => {
  prepareFor = async (body) => ({ data: { ...prepared(body), corrects: 'entry-older' } });
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(COPY.PREPARATION_RECEIPT_FAILED);
  expect(client.getQueryState(CORRECTIONS_KEY)?.isInvalidated).toBe(false);
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
  fill(COPY.REASON, 'Reverse the duplicated transfer');
  expect(screen.queryByRole('alert')).toBeNull();
  prepareFor = async (body) => ({ data: prepared(body) });
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations().map((body) => [body.operationId, body.reason])).toEqual([
    [KEY(2), 'Reverse the transfer recorded in error'],
    [KEY(2), 'Reverse the transfer recorded in error'],
    [KEY(3), 'Reverse the duplicated transfer'],
  ]);
  expect(uploads()).toHaveLength(1);
});

it("shows the server's reason for a refused preparation", async () => {
  prepareFor = async () => {
    throw { response: { status: 400, data: ['This entry cannot be compensated. Review the current register.'] } };
  };
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe(
    'This entry cannot be compensated. Review the current register.',
  );
});

it('refreshes the entry and appointments after a conflict and prepares the next attempt under a new operation', async () => {
  let conflict = true;
  prepareFor = async (body) => {
    if (conflict) throw { response: { status: 409, data: { detail: 'The register operation conflicts.' } } };
    return { data: prepared(body) };
  };
  show();
  await ready();
  const entriesRead = reads(ENTRIES);
  const appointmentsRead = reads(APPOINTMENTS);
  complete();
  fireEvent.click(submitButton());
  expect((await screen.findByRole('alert')).textContent).toBe('The register operation conflicts.');
  await waitFor(() => expect(reads(ENTRIES)).toBe(entriesRead + 1));
  expect(reads(APPOINTMENTS)).toBe(appointmentsRead + 1);
  conflict = false;
  fireEvent.click(submitButton());
  expect(await screen.findByText('Register page')).toBeTruthy();
  expect(preparations().map((body) => body.operationId)).toEqual([KEY(2), KEY(3)]);
});

it('withdraws the form once a refresh after a conflict shows that another correction reversed the entry', async () => {
  prepareFor = async () => {
    throw { response: { status: 409, data: { detail: 'The register operation conflicts.' } } };
  };
  show();
  await ready();
  complete();
  entryPages = [page([entry({ correctable: false, correctedBy: 'entry-correction' })])];
  serve();
  fireEvent.click(submitButton());
  expect(await screen.findByText(COPY.CORRECTED_NOTE)).toBeTruthy();
  expect(screen.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
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
  const pending = deferred<{ data: RegisterCorrection }>();
  prepareFor = () => pending.promise;
  show();
  await ready();
  complete();
  fireEvent.click(submitButton());
  await waitFor(() => expect(preparations()).toHaveLength(1));
  act(switchAccount);
  await act(async () => pending.resolve({ data: prepared(preparations()[0]) }));
  expect(client.getQueryState(CORRECTIONS_KEY)?.isInvalidated).toBe(false);
  expect(screen.queryByText('Register page')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps no entry whose read returns after the signed-in account changed', async () => {
  const pending = deferred<ReturnType<typeof page<RegisterEntry>>>();
  const read = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string, config?: unknown) =>
    url === ENTRIES ? pending.promise : read(url, config),
  );
  show();
  await waitFor(() => expect(reads(ENTRIES)).toBe(1));
  act(switchAccount);
  await act(async () => pending.resolve(page([entry()])));
  expect(client.getQueryData(ENTRY_KEY)).toBeUndefined();
});

it('starts a blank draft for another signed-in account', async () => {
  show();
  await ready();
  complete();
  expect((screen.getByLabelText(COPY.REASON) as HTMLTextAreaElement).value).toContain('Reverse the transfer');
  act(switchAccount);
  await waitFor(() => expect((screen.getByLabelText(COPY.REASON) as HTMLTextAreaElement).value).toBe(''));
  expect(submitButton().disabled).toBe(true);
});

it("starts a blank draft for another signed-in account even when that account's reads are cached", async () => {
  const other = ['tokens', 'register', 'profile-two', 'account-two'];
  client.setQueryData([...other, 'classes'], [LISTED]);
  client.setQueryData(['company-appointments', 'profile-two', 'account-two'], [appointment(['prepare'])]);
  client.setQueryData([...other, 'entries', 'ordinary', 'entry-transfer'], entry());
  show();
  await ready();
  complete();
  act(switchAccount);
  expect(screen.queryByRole('status')).toBeNull();
  expect((screen.getByLabelText(COPY.REASON) as HTMLTextAreaElement).value).toBe('');
  expect((screen.getByLabelText(COPY.AUTHORITY_REFERENCE) as HTMLInputElement).value).toBe('');
  expect(submitButton().disabled).toBe(true);
});

it('keeps the draft but holds preparation after a failed refresh until a retry succeeds', async () => {
  show();
  await ready();
  complete();
  expect(submitButton().disabled).toBe(false);
  api.get.mockImplementation(async (url: string) => {
    if (url === ENTRIES) throw new Error('Unavailable');
    if (url === APPOINTMENTS) return page(appointments);
    return page([LISTED]);
  });
  await act(async () => {
    await client.refetchQueries({ queryKey: ENTRY_KEY });
  });
  expect((await screen.findByRole('alert')).textContent).toContain("We couldn't load the complete register.");
  expect((screen.getByLabelText(COPY.REASON) as HTMLTextAreaElement).value).toBe(
    '  Reverse the transfer recorded in error  ',
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

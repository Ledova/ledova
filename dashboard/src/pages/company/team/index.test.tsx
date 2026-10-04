// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  USER_PREFERENCES_QUERY_KEY,
  type CreateCompanyTeamInvitationRequest,
  type OwnCompanyAppointment,
  type CompanyTeamAppointment,
} from '@ledova/shared';
import { PageTitle } from '@components/PageTitle';
import SettingsPage from '@pages/settings';
import CompanyTeamPage from './index';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const providedApi = Object.assign(axios.create(), api);
const appointmentsUrl = '/api/v1/company-authority/appointments/';
const invitationsUrl = '/api/v1/company-authority/invitations/';
const ownKey = ['company-appointments', 'profile-a', 'account-a'];
const teamKey = ['company-team', 'profile-a', 'account-a', 'company-a'];
const ownerA = { userProfile: 'profile-a', userAccount: { uuid: 'account-a' }, company: null, investor: 'investor-a' };
const ownerB = { userProfile: 'profile-b', userAccount: { uuid: 'account-b' }, company: null, investor: 'investor-b' };
const code = 's'.repeat(43);
let client: QueryClient;
let rows: OwnCompanyAppointment[];
let teamRows: CompanyTeamAppointment[];

function appointment(overrides: Partial<OwnCompanyAppointment> = {}): OwnCompanyAppointment {
  return {
    uuid: 'appointment-a',
    company: 'company-a',
    companyName: 'Harbour Synthetic Pty Ltd',
    source: 'initial',
    status: 'active',
    isEffective: true,
    capabilities: ['admin'],
    delegatableCapabilities: ['admin', 'prepare', 'approve'],
    createdAt: '2026-10-04T01:00:00Z',
    expiresAt: null,
    revokedAt: null,
    declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION,
    declarationText: COMPANY_AUTHORITY_DECLARATION,
    ...overrides,
  };
}

function teamAppointment(overrides: Partial<CompanyTeamAppointment> = {}): CompanyTeamAppointment {
  return {
    uuid: 'appointment-child',
    company: 'company-a',
    source: 'invitation',
    status: 'active',
    isEffective: true,
    capabilities: ['prepare'],
    delegatableCapabilities: [],
    createdAt: '2026-10-04T02:00:00Z',
    expiresAt: null,
    revokedAt: null,
    name: 'Synthetic Delegate',
    email: 'delegate@example.test',
    ...overrides,
  };
}

function revoked(target = appointment()) {
  return { ...target, status: 'revoked', isEffective: false, revokedAt: '2026-10-04T03:00:00Z' };
}

function page(results: unknown[], next: string | null = null) {
  return { data: { results, next, count: results.length, previous: null } };
}

function issued(data: CreateCompanyTeamInvitationRequest, issuedCode: string | null = code) {
  return {
    status: issuedCode === null ? 200 : 201,
    data: {
      ...data,
      delegatableCapabilities: data.delegatableCapabilities ?? [],
      uuid: 'invitation-a',
      companyName: 'Harbour Synthetic Pty Ltd',
      code: issuedCode,
      createdAt: '2026-10-04T03:00:00Z',
      acceptanceDeadline: data.acceptanceDeadline ?? '2099-10-11T03:00:00Z',
      appointmentExpiresAt: data.appointmentExpiresAt ?? null,
      acceptedAt: null,
    },
  };
}

function show(settings = false) {
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={providedApi}>
        <MemoryRouter>
          <PageTitle.Provider value={settings ? 'Settings' : 'Company team'}>
            {settings ? <SettingsPage /> : <CompanyTeamPage />}
          </PageTitle.Provider>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

async function selectSource(uuid = 'appointment-a') {
  await screen.findByRole('option', { name: 'Harbour Synthetic Pty Ltd' });
  fireEvent.change(await screen.findByLabelText('Company'), { target: { value: 'company-a' } });
  fireEvent.change(screen.getByLabelText('Delegating appointment'), { target: { value: uuid } });
  return screen.findByRole('group', { name: 'Actions for the appointee' });
}

function choose(scope: 'personal' | 'delegatable', label: string) {
  fireEvent.click(
    within(
      screen.getByRole('group', {
        name: scope === 'personal' ? 'Actions for the appointee' : 'Actions the appointee may delegate',
      }),
    ).getByRole('checkbox', { name: label }),
  );
}

async function openRevoke(uuid = 'appointment-a') {
  const open = await screen.findByRole('button', { name: `Revoke appointment ${uuid}` });
  await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(open);
  return screen.findByRole('button', { name: 'Permanently revoke appointment' });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: ownerA });
  rows = [appointment()];
  teamRows = [];
  api.get.mockImplementation(async (url: string) => {
    if (url === appointmentsUrl) return page(rows);
    if (url === invitationsUrl) return page([]);
    if (url === `${appointmentsUrl}team/`) return { data: teamRows };
    throw new Error(`Unexpected read ${url}`);
  });
  api.post.mockImplementation(async (url: string, data: CreateCompanyTeamInvitationRequest) => {
    if (url === invitationsUrl) return issued(data);
    if (url === `${invitationsUrl}accept/`) return { data: appointment({ source: 'invitation', uuid: 'accepted-a' }) };
    return { data: revoked() };
  });
});

afterEach(() => {
  focusManager.setFocused(undefined);
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('offers an account-area entry to investor-only accounts without a company tab', () => {
  show(true);
  expect(screen.getByRole('link', { name: /Company team/ }).getAttribute('href')).toBe('/company/team');
});

it.each(['active', 'expired'] as const)(
  'retains and revokes %s legacy-owner history without inventing a declaration',
  async (status) => {
    const legacy = appointment({
      source: 'legacy_owner',
      declarationVersion: null,
      declarationText: null,
      status,
      isEffective: status === 'active',
      expiresAt: status === 'expired' ? '2020-01-01T00:00:00Z' : null,
    });
    rows = [legacy];
    api.post.mockResolvedValue({ data: revoked(legacy) });
    show();
    const record = within((await screen.findByText(legacy.uuid)).closest('li')!);
    expect(record.getByText('Legacy company owner')).toBeTruthy();
    expect(record.queryByText(COMPANY_AUTHORITY_DECLARATION)).toBeNull();
    if (status === 'active') await selectSource();
    const confirm = await openRevoke();
    expect(screen.getByText(/revoking an initial or legacy-owner appointment does not reopen admission/)).toBeTruthy();
    fireEvent.click(confirm);
    await waitFor(() => expect(client.getQueryData<OwnCompanyAppointment[]>(ownKey)?.[0].status).toBe('revoked'));
    expect(record.getByText('Legacy company owner')).toBeTruthy();
    expect(record.getByText('Not current')).toBeTruthy();
    expect(record.queryByText(COMPANY_AUTHORITY_DECLARATION)).toBeNull();
    expect(client.getQueryData<OwnCompanyAppointment[]>(ownKey)?.[0]).toMatchObject({
      source: 'legacy_owner',
      declarationVersion: null,
      declarationText: null,
    });
  },
);

it.each(['initial', 'invitation'] as const)(
  'refuses a %s revocation receipt with missing declaration fields',
  async (source) => {
    rows = [appointment({ source })];
    api.post.mockResolvedValue({
      data: revoked(appointment({ source, declarationVersion: null, declarationText: null })),
    });
    show();
    fireEvent.click(await openRevoke());
    await screen.findByText(/revocation outcome could not be confirmed/);
    expect(client.getQueryData<OwnCompanyAppointment[]>(ownKey)?.[0].status).toBe('active');
  },
);

it('refuses fabricated declaration fields on a legacy-owner revocation receipt', async () => {
  rows = [appointment({ source: 'legacy_owner', declarationVersion: null, declarationText: null })];
  api.post.mockResolvedValue({ data: revoked(appointment({ source: 'legacy_owner' })) });
  show();
  fireEvent.click(await openRevoke());
  await screen.findByText(/revocation outcome could not be confirmed/);
  expect(client.getQueryData<OwnCompanyAppointment[]>(ownKey)?.[0].status).toBe('active');
});

it('refuses a legacy-owner response from invitation acceptance', async () => {
  api.post.mockResolvedValue({
    data: appointment({ source: 'legacy_owner', declarationVersion: null, declarationText: null }),
  });
  show();
  fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Accept company authorisation declaration' }));
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
  await screen.findByText(/appointment outcome could not be confirmed/);
  expect(screen.queryByText(/Appointment recorded for/)).toBeNull();
  expect((screen.getByLabelText('Invitation code') as HTMLInputElement).value).toBe(code);
});

it('paginates own appointment history and invitations without fetching global company details', async () => {
  const second = appointment({
    uuid: 'historical-b',
    company: 'company-b',
    companyName: 'Inland Synthetic Pty Ltd',
    source: 'invitation',
    status: 'expired',
    isEffective: false,
    expiresAt: '2020-01-01T00:00:00Z',
  });
  api.get.mockImplementation(async (url: string, config: { params: { page: number } }) => {
    if (url === appointmentsUrl)
      return config.params.page === 2 ? page([second]) : page(rows, 'http://localhost/?page=2');
    return config.params.page === 2
      ? page([
          {
            ...issued({
              company: 'company-b',
              inviterAppointment: 'historical-b',
              idempotencyKey: 'key-b',
              capabilities: ['prepare'],
            }).data,
            uuid: 'invitation-b',
            code: undefined,
          },
        ])
      : page([], 'http://localhost/?page=2');
  });
  show();
  expect(await screen.findByText('historical-b')).toBeTruthy();
  expect(await screen.findByText('invitation-b')).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Inland Synthetic Pty Ltd' })).toBeTruthy();
  expect((screen.getByLabelText('Company') as HTMLSelectElement).value).toBe('');
  expect(screen.queryByRole('group', { name: 'Actions for the appointee' })).toBeNull();
  expect(api.get.mock.calls.map(([url]) => url)).toEqual([
    appointmentsUrl,
    invitationsUrl,
    appointmentsUrl,
    invitationsUrl,
  ]);
});

it('bounds separate personal and delegatable choices by the selected source', async () => {
  rows = [appointment({ capabilities: ['prepare'], delegatableCapabilities: ['approve'] })];
  show();
  await selectSource();
  expect(screen.queryByRole('checkbox', { name: 'Manage company information and team' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'Prepare register changes' })).toBeNull();
  choose('delegatable', 'Approve register changes');
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  expect(await screen.findByLabelText('One-time invitation code')).toBeTruthy();
  expect(api.post.mock.calls[0][1]).toMatchObject({
    company: 'company-a',
    inviterAppointment: 'appointment-a',
    capabilities: [],
    delegatableCapabilities: ['approve'],
  });
  expect(api.get.mock.calls.some(([url]) => url === `${appointmentsUrl}team/`)).toBe(false);
});

it('does not offer administrator grants from delegatable admin without personal administrator authority', async () => {
  rows = [appointment({ capabilities: [], delegatableCapabilities: ['admin', 'prepare'] })];
  show();
  await selectSource();
  expect(screen.queryByRole('checkbox', { name: 'Manage company information and team' })).toBeNull();
  expect(screen.getAllByRole('checkbox', { name: 'Prepare register changes' })).toHaveLength(2);
});

it('allows an administrator to delegate from a separate current source with administrator scope', async () => {
  rows = [
    appointment({ delegatableCapabilities: [] }),
    appointment({ uuid: 'source-b', capabilities: [], delegatableCapabilities: ['admin'] }),
  ];
  show();
  await selectSource('source-b');
  expect(screen.getAllByRole('checkbox', { name: 'Manage company information and team' })).toHaveLength(2);
  choose('personal', 'Manage company information and team');
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  await screen.findByLabelText('One-time invitation code');
  expect(api.post.mock.calls[0][1]).toMatchObject({
    inviterAppointment: 'source-b',
    capabilities: ['admin'],
    delegatableCapabilities: [],
  });
});

it('retains the issue key for an unchanged failed retry and honestly displays a null-code receipt', async () => {
  api.post
    .mockRejectedValueOnce(new Error('Synthetic disconnected response'))
    .mockImplementationOnce(async (_url, data) => issued(data, null));
  show();
  await selectSource();
  choose('personal', 'Prepare register changes');
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  await screen.findByText('Synthetic disconnected response');
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  expect(await screen.findByText(/No code is available on this retry/)).toBeTruthy();
  expect(api.post.mock.calls[0][1].idempotencyKey).toBe(api.post.mock.calls[1][1].idempotencyKey);
  expect(screen.queryByLabelText('One-time invitation code')).toBeNull();
});

it('uses a fresh issue key when retry terms change', async () => {
  api.post.mockRejectedValueOnce(new Error('Synthetic retry'));
  show();
  await selectSource();
  choose('personal', 'Prepare register changes');
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  await screen.findByText('Synthetic retry');
  choose('delegatable', 'Approve register changes');
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  await screen.findByLabelText('One-time invitation code');
  expect(api.post.mock.calls[0][1].idempotencyKey).not.toBe(api.post.mock.calls[1][1].idempotencyKey);
});

it('keeps a newly issued code out of query caches, mutation caches and browser storage', async () => {
  const stored = vi.spyOn(Storage.prototype, 'setItem');
  show();
  await selectSource();
  choose('personal', 'Prepare register changes');
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  const input = (await screen.findByLabelText('One-time invitation code')) as HTMLInputElement;
  expect(input.value).toBe(code);
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain(code);
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  expect(stored).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Delegating appointment'), { target: { value: '' } });
  expect(screen.queryByLabelText('One-time invitation code')).toBeNull();
});

it('suppresses duplicate issue taps while preserving the exact requested deadline and expiry', async () => {
  const result = deferred<ReturnType<typeof issued>>();
  api.post.mockReturnValue(result.promise);
  show();
  await selectSource();
  choose('personal', 'Prepare register changes');
  fireEvent.change(screen.getByLabelText('Invitation deadline (UTC, optional)'), { target: { value: '2026-10-10' } });
  fireEvent.change(screen.getByLabelText('Appointment expiry (UTC, optional)'), { target: { value: '2026-11-01' } });
  const create = screen.getByRole('button', { name: 'Create invitation' });
  fireEvent.click(create);
  fireEvent.click(create);
  expect(api.post).toHaveBeenCalledTimes(1);
  const terms = api.post.mock.calls[0][1];
  expect(terms).toMatchObject({
    acceptanceDeadline: '2026-10-10T23:59:59Z',
    appointmentExpiresAt: '2026-11-01T23:59:59Z',
  });
  await act(async () => result.resolve(issued(terms)));
  await screen.findByLabelText('One-time invitation code');
});

it('rechecks local source expiry at dispatch even before a timer causes a rerender', async () => {
  const expiry = Date.now() + 60_000;
  rows = [appointment({ expiresAt: new Date(expiry).toISOString() })];
  show();
  await selectSource();
  choose('personal', 'Prepare register changes');
  vi.spyOn(Date, 'now').mockReturnValue(expiry);
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  await screen.findByText(/No current appointment can delegate actions for this company/);
  expect(api.post).not.toHaveBeenCalled();
});

it('discards an issued code after an account change and invalidates the transport guard', async () => {
  const result = deferred<ReturnType<typeof issued>>();
  api.post.mockReturnValue(result.promise);
  show();
  await selectSource();
  choose('personal', 'Prepare register changes');
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  const terms = api.post.mock.calls[0][1];
  const guard = api.post.mock.calls[0][2].ledovaSubmissionGuard;
  act(() => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: ownerB }));
  expect(() => guard()).toThrow(/account changed/);
  await act(async () => result.resolve(issued(terms)));
  expect(screen.queryByLabelText('One-time invitation code')).toBeNull();
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain(code);
});

it('refuses an unbound or non-new code receipt while preserving the issue key for retry', async () => {
  api.post.mockImplementationOnce(async (_url, data) => ({ ...issued(data), status: 200 }));
  show();
  await selectSource();
  choose('personal', 'Prepare register changes');
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  await screen.findByText(/invitation outcome could not be confirmed/);
  expect(screen.queryByLabelText('One-time invitation code')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  await screen.findByLabelText('One-time invitation code');
  expect(api.post.mock.calls[0][1].idempotencyKey).toBe(api.post.mock.calls[1][1].idempotencyKey);
});

it('requires the exact declaration checkbox before accepting and suppresses duplicate taps', async () => {
  const result = deferred<{ data: OwnCompanyAppointment }>();
  api.post.mockReturnValue(result.promise);
  show();
  fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: code } });
  const accept = screen.getByRole('button', { name: 'Accept invitation' });
  expect((accept as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getAllByText(COMPANY_AUTHORITY_DECLARATION).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Accept company authorisation declaration' }));
  fireEvent.click(accept);
  fireEvent.click(accept);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post.mock.calls[0]).toEqual([
    `${invitationsUrl}accept/`,
    { code, declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION, acceptDeclaration: true },
    { ledovaSubmissionGuard: expect.any(Function) },
  ]);
  await act(async () => result.resolve({ data: appointment({ source: 'invitation', uuid: 'accepted-a' }) }));
  expect(await screen.findByText(/Appointment recorded for Harbour Synthetic Pty Ltd: accepted-a/)).toBeTruthy();
  expect((screen.getByLabelText('Invitation code') as HTMLInputElement).value).toBe('');
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});

it('requires fresh declaration agreement after editing an invitation code', async () => {
  show();
  await screen.findByText('Your appointments');
  const input = screen.getByLabelText('Invitation code');
  const declaration = screen.getByRole('checkbox', { name: 'Accept company authorisation declaration' });
  const accept = screen.getByRole('button', { name: 'Accept invitation' });
  fireEvent.change(input, { target: { value: code } });
  fireEvent.click(declaration);
  expect((accept as HTMLButtonElement).disabled).toBe(false);
  const changedCode = 't'.repeat(43);
  fireEvent.change(input, { target: { value: changedCode } });
  expect((declaration as HTMLInputElement).checked).toBe(false);
  expect((accept as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(accept);
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(declaration);
  fireEvent.click(accept);
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
  expect(api.post).toHaveBeenCalledWith(
    `${invitationsUrl}accept/`,
    { code: changedCode, declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION, acceptDeclaration: true },
    expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
  );
});

it('keeps acceptance acknowledgment historical after the accepted appointment is revoked and refreshed', async () => {
  const accepted = appointment({ source: 'invitation', uuid: 'accepted-a' });
  const revokedAccepted = {
    ...accepted,
    status: 'revoked' as const,
    isEffective: false,
    revokedAt: '2026-10-04T03:00:00Z',
  };
  api.post.mockImplementation(async (url: string) => {
    if (url === `${invitationsUrl}accept/`) {
      rows = [...rows, accepted];
      return { data: accepted };
    }
    if (url === `${appointmentsUrl}${accepted.uuid}/revoke/`) {
      rows = rows.map((record) => (record.uuid === accepted.uuid ? revokedAccepted : record));
      return { data: revokedAccepted };
    }
    throw new Error(`Unexpected write ${url}`);
  });
  show();
  await screen.findByRole('button', { name: 'Revoke appointment appointment-a' });
  fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Accept company authorisation declaration' }));
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
  await screen.findByText(/Appointment recorded for Harbour Synthetic Pty Ltd: accepted-a/);
  fireEvent.click(await openRevoke(accepted.uuid));
  await waitFor(() => expect(client.getQueryData<OwnCompanyAppointment[]>(ownKey)?.[1].status).toBe('revoked'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh appointments' }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Refresh appointments' }) as HTMLButtonElement).disabled).toBe(false),
  );
  const history = within(screen.getByText(accepted.uuid).closest('li')!);
  expect(history.getByText('revoked')).toBeTruthy();
  expect(history.getByText('Not current')).toBeTruthy();
  const receipt = screen.getByText(/Appointment recorded for Harbour Synthetic Pty Ltd: accepted-a/);
  expect(receipt.textContent).not.toMatch(/\bactive\b|\bcurrent\b/i);
  expect(api.post.mock.calls.map(([url]) => url)).toEqual([
    `${invitationsUrl}accept/`,
    `${appointmentsUrl}${accepted.uuid}/revoke/`,
  ]);
});

it('retains the code and declaration selection after configured account or identity refusal', async () => {
  api.post.mockRejectedValueOnce(new Error('Complete the configured identity check'));
  show();
  fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Accept company authorisation declaration' }));
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
  await screen.findByText('Complete the configured identity check');
  expect((screen.getByLabelText('Invitation code') as HTMLInputElement).value).toBe(code);
  expect(
    (screen.getByRole('checkbox', { name: 'Accept company authorisation declaration' }) as HTMLInputElement).checked,
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
  await screen.findByText(/Appointment recorded for/);
  expect(api.post).toHaveBeenCalledTimes(2);
});

it('does not manufacture acceptance from a mismatched declaration receipt', async () => {
  api.post.mockResolvedValue({ data: appointment({ source: 'invitation', declarationText: 'Foreign declaration' }) });
  show();
  fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Accept company authorisation declaration' }));
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
  await screen.findByText(/appointment outcome could not be confirmed/);
  expect(screen.queryByText(/Appointment recorded for/)).toBeNull();
  expect((screen.getByLabelText('Invitation code') as HTMLInputElement).value).toBe(code);
});

it('discards acceptance and raw code when the account changes during a pending response', async () => {
  const result = deferred<{ data: OwnCompanyAppointment }>();
  api.post.mockReturnValue(result.promise);
  show();
  fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Accept company authorisation declaration' }));
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
  const guard = api.post.mock.calls[0][2].ledovaSubmissionGuard;
  act(() => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: ownerB }));
  expect(() => guard()).toThrow(/account changed/);
  await act(async () => result.resolve({ data: appointment({ source: 'invitation' }) }));
  expect(screen.queryByText(/Appointment recorded for/)).toBeNull();
  expect((screen.getByLabelText('Invitation code') as HTMLInputElement).value).toBe('');
});

it('reads team names and emails only with current personal administrator authority and the selected company', async () => {
  teamRows = [
    Object.assign(teamAppointment(), {
      userProfile: 'private-profile',
      declarationText: 'private-declaration',
      code: 'private-code',
    }),
  ];
  show();
  await selectSource();
  expect(await screen.findByText('delegate@example.test')).toBeTruthy();
  expect(screen.getByText('Synthetic Delegate')).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith(`${appointmentsUrl}team/`, {
    params: { company: 'company-a' },
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(screen.queryByText(/private-profile|private-declaration|private-code/)).toBeNull();
});

it('rejects a foreign-company team response', async () => {
  teamRows = [teamAppointment({ company: 'company-b' })];
  show();
  await selectSource();
  expect(await screen.findByText(/Company team could not be loaded/)).toBeTruthy();
  expect(screen.queryByText('delegate@example.test')).toBeNull();
});

it('hides retained team cache after a failed refresh', async () => {
  teamRows = [teamAppointment()];
  show();
  await selectSource();
  await screen.findByText('delegate@example.test');
  api.get.mockImplementation(async (url) => {
    if (url === `${appointmentsUrl}team/`) throw new Error('Synthetic refusal');
    return url === appointmentsUrl ? page(rows) : page([]);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh company team' }));
  await screen.findByText(/Company team could not be loaded/);
  expect(client.getQueryData(teamKey)).toEqual(teamRows);
  expect(screen.queryByText('delegate@example.test')).toBeNull();
});

it('hides retained own authority after a failed refresh and prevents invitation issue', async () => {
  show();
  await selectSource();
  choose('personal', 'Prepare register changes');
  api.get.mockImplementation(async (url) => {
    if (url === appointmentsUrl) throw new Error('Synthetic refusal');
    return page([]);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh appointments' }));
  await screen.findByText(/Your appointments could not be loaded/);
  expect(client.getQueryData(ownKey)).toEqual(rows);
  expect(screen.queryByRole('button', { name: 'Create invitation' })).toBeNull();
  expect(screen.queryByText('appointment-a')).toBeNull();
});

it.each(['cancel', 'escape'] as const)('invalidates a retained confirmation immediately after %s', async (action) => {
  show();
  const button = await openRevoke();
  expect(screen.getByText(/revoking an initial or legacy-owner appointment does not reopen admission/)).toBeTruthy();
  if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  else fireEvent.keyDown(button, { key: 'Escape' });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(api.post).not.toHaveBeenCalled();
});

it('consumes a confirmation before duplicate clicks and retains immutable revocation history', async () => {
  const result = deferred<{ data: ReturnType<typeof revoked> }>();
  api.post.mockReturnValue(result.promise);
  show();
  const button = await openRevoke();
  fireEvent.click(button);
  fireEvent.click(button);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post.mock.calls[0][0]).toBe(`${appointmentsUrl}appointment-a/revoke/`);
  await act(async () => result.resolve({ data: revoked() }));
  await waitFor(() => expect(client.getQueryData<OwnCompanyAppointment[]>(ownKey)?.[0].status).toBe('revoked'));
  expect(screen.queryByRole('button', { name: 'Revoke appointment appointment-a' })).toBeNull();
  expect(screen.getByText('Initial self-declaration')).toBeTruthy();
});

it('requires a fresh confirmation after a failed revoke and supports retry', async () => {
  api.post.mockRejectedValueOnce(new Error('Synthetic revoke failed'));
  show();
  const oldButton = await openRevoke();
  fireEvent.click(oldButton);
  await screen.findByText('Synthetic revoke failed');
  fireEvent.click(oldButton);
  expect(api.post).toHaveBeenCalledTimes(1);
  fireEvent.click(await openRevoke());
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(client.getQueryData<OwnCompanyAppointment[]>(ownKey)?.[0].status).toBe('revoked'));
});

it('keeps expired and ineffective own appointments self-revocable', async () => {
  const target = appointment({ status: 'expired', isEffective: false, expiresAt: '2020-01-01T00:00:00Z' });
  rows = [target];
  api.post.mockResolvedValue({ data: revoked(target) });
  show();
  fireEvent.click(await openRevoke());
  await waitFor(() => expect(client.getQueryData<OwnCompanyAppointment[]>(ownKey)?.[0].status).toBe('revoked'));
});

it('refuses stale account confirmation before transport and discards pending revocation after account change', async () => {
  const result = deferred<{ data: ReturnType<typeof revoked> }>();
  api.post.mockReturnValue(result.promise);
  show();
  const button = await openRevoke();
  act(() => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: ownerB });
    fireEvent.click(button);
  });
  expect(api.post).not.toHaveBeenCalled();
  act(() => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: ownerA }));
  fireEvent.click(await openRevoke());
  act(() => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: ownerB }));
  await act(async () => result.resolve({ data: revoked() }));
  expect(client.getQueryData<OwnCompanyAppointment[]>(ownKey)?.[0].status).toBe('active');
});

it('blocks an open team confirmation after personal administrator authority is revoked', async () => {
  teamRows = [teamAppointment()];
  show();
  await selectSource();
  const button = await openRevoke('appointment-child');
  act(() => client.setQueryData(ownKey, [revoked()]));
  fireEvent.click(button);
  expect(api.post).not.toHaveBeenCalled();
});

it('updates a revoked team row without copying another appointee into own appointment history', async () => {
  const target = teamAppointment();
  teamRows = [target];
  const receipt = appointment({ ...target, companyName: 'Harbour Synthetic Pty Ltd' });
  api.post.mockResolvedValue({ data: revoked(receipt) });
  show();
  await selectSource();
  fireEvent.click(await openRevoke('appointment-child'));
  await waitFor(() => expect(client.getQueryData<CompanyTeamAppointment[]>(teamKey)?.[0].status).toBe('revoked'));
  expect(client.getQueryData<OwnCompanyAppointment[]>(ownKey)?.map((item) => item.uuid)).toEqual(['appointment-a']);
  expect(client.getQueryData<CompanyTeamAppointment[]>(teamKey)?.[0]).not.toHaveProperty('declarationText');
});

it('refuses a revocation receipt that changes the frozen scope or expiry', async () => {
  api.post.mockResolvedValue({ data: revoked(appointment({ expiresAt: '2099-01-01T00:00:00Z' })) });
  show();
  fireEvent.click(await openRevoke());
  await screen.findByText(/revocation outcome could not be confirmed/);
  expect(client.getQueryData<OwnCompanyAppointment[]>(ownKey)?.[0].status).toBe('active');
});

it('retains the displayed one-time code through a default focus refetch', async () => {
  show();
  await selectSource();
  choose('personal', 'Prepare register changes');
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  const input = await screen.findByLabelText('One-time invitation code');
  const refreshed = deferred<ReturnType<typeof page>>();
  const original = api.get.getMockImplementation()!;
  api.get.mockImplementation((url: string, config: unknown) =>
    url === appointmentsUrl ? refreshed.promise : original(url, config),
  );
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => expect(client.getQueryState(ownKey)?.fetchStatus).toBe('fetching'));
  expect(screen.getByLabelText('One-time invitation code')).toBe(input);
  expect(input).toHaveProperty('value', code);
  expect(screen.getByRole('button', { name: 'Create another invitation' })).toHaveProperty('disabled', true);
  await act(async () => refreshed.resolve(page(rows)));
  await waitFor(() => expect(client.getQueryState(ownKey)?.fetchStatus).toBe('idle'));
  expect(screen.getByLabelText('One-time invitation code')).toBe(input);
  expect(api.post).toHaveBeenCalledOnce();
});

it('retains the interrupted issue key through a focus refetch and replays one recorded invitation', async () => {
  const outcome = deferred<ReturnType<typeof issued>>();
  const retained = new Set<string>();
  api.post.mockImplementation((_url, data: CreateCompanyTeamInvitationRequest) => {
    const existed = retained.has(data.idempotencyKey);
    retained.add(data.idempotencyKey);
    return existed ? Promise.resolve(issued(data, null)) : outcome.promise;
  });
  show();
  await selectSource();
  choose('personal', 'Prepare register changes');
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
  const firstKey = api.post.mock.calls[0][1].idempotencyKey;
  const refreshed = deferred<ReturnType<typeof page>>();
  const original = api.get.getMockImplementation()!;
  api.get.mockImplementation((url: string, config: unknown) =>
    url === appointmentsUrl ? refreshed.promise : original(url, config),
  );
  act(() => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => expect(client.getQueryState(ownKey)?.fetchStatus).toBe('fetching'));
  await act(async () => outcome.resolve(issued(api.post.mock.calls[0][1])));
  await act(async () => refreshed.resolve(page(rows)));
  await waitFor(() => expect(client.getQueryState(ownKey)?.fetchStatus).toBe('idle'));
  const chosen = within(screen.getByRole('group', { name: 'Actions for the appointee' })).getByRole('checkbox', {
    name: 'Prepare register changes',
  });
  if (!(chosen as HTMLInputElement).checked) fireEvent.click(chosen);
  fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
  await screen.findByText(/No code is available on this retry/);
  expect(api.post.mock.calls[1][1].idempotencyKey).toBe(firstKey);
  expect(retained.size).toBe(1);
});

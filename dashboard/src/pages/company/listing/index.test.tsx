// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { USER_PREFERENCES_QUERY_KEY, type Company, type CompanyActivationAttempt } from '@ledova/shared';
import ListingPage from '.';
import { companyRecord, companyPreferences, renderCompanyPage } from '../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const LIST = '/api/v1/companies/';
const DETAIL = LIST + 'company-one/';
const KEY = '70000000-0000-4000-8000-000000000001';
const APPOINTMENT = '80000000-0000-4000-8000-000000000001';
let client: QueryClient;
let company: Company;
let rows: Company[];
let failed: string | null;
const attempt = (overrides: Partial<CompanyActivationAttempt> = {}): CompanyActivationAttempt => ({
  uuid: '90000000-0000-4000-8000-000000000001',
  idempotencyKey: KEY,
  appointment: APPOINTMENT,
  lifecycleRevision: 2,
  status: 'failed',
  reason: 'unconfigured',
  startedAt: '2026-10-05T01:00:00Z',
  completedAt: '2026-10-05T01:00:01Z',
  appliedAt: null,
  declarationVersion: '2026-10-04',
  declarationText: 'Synthetic current declaration',
  ...overrides,
});
function show() {
  return renderCompanyPage(client, <ListingPage />, 'Activation');
}
async function review() {
  fireEvent.click(await screen.findByRole('button', { name: /Review activation|Try activation again/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox'));
  return dialog;
}
async function confirm() {
  const dialog = await review();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm activation' }));
}
function detailKey() {
  return client.getQueryCache().findAll({ queryKey: ['company', company.uuid] })[0]!.queryKey;
}
function listKey() {
  return client.getQueryCache().findAll({ queryKey: ['companies'] })[0]!.queryKey;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(KEY);
  failed = null;
  company = companyRecord({
    isOwner: false,
    activation: {
      appointment: APPOINTMENT,
      lifecycleRevision: 2,
      declarationVersion: '2026-10-04',
      declarationText: 'Synthetic current declaration',
      latestAttempt: null,
    },
  });
  rows = [company];
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity }, mutations: { retry: false } },
  });
  api.get.mockImplementation(async (url: string) => {
    if (url === failed) throw new Error('Unavailable');
    if (url === LIST) return { data: { results: rows, next: null } };
    if (url === DETAIL) return { data: { ...company } };
    throw new Error(`Unexpected request: ${url}`);
  });
  api.post.mockImplementation(async () => {
    company = { ...company, activation: { ...company.activation!, latestAttempt: attempt() } };
    rows = [company];
    return { status: 200, data: { message: 'Activation check recorded.', company, attempt: attempt() } };
  });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: companyPreferences('investor') });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('activates for an investor-role nonowner personal administrator without any upload prerequisite or operator read', async () => {
  show();
  await confirm();
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  expect(api.post).toHaveBeenCalledWith(
    DETAIL + 'activate/',
    {
      idempotencyKey: KEY,
      appointment: APPOINTMENT,
      lifecycleRevision: 2,
      declarationVersion: '2026-10-04',
      acceptDeclaration: true,
    },
    expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
  );
  expect(await screen.findByText(/The ABR lookup is not configured/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Submit application' })).toBeNull();
  expect(screen.queryByText('Required documents')).toBeNull();
  expect(api.get.mock.calls.some(([url]) => url === '/api/operator/')).toBe(false);
});

it.each([
  ['draft-only owner', { capabilities: [], draftSetup: true }, true],
  ['delegatable-only administrator', { capabilities: [], draftSetup: false }, false],
  ['owner without appointment', { capabilities: [], draftSetup: false }, true],
] as const)('refuses %s activation while leaving own identity guidance reachable', async (_, access, isOwner) => {
  company = {
    ...company,
    isOwner,
    administrativeAccess: { capabilities: [...access.capabilities], draftSetup: access.draftSetup },
    activation: null,
  };
  rows = [company];
  show();
  expect(await screen.findByText(/A current personal administrator appointment is required/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open your profile' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Review activation' })).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

it('requires explicit company selection when multiple appointments are listed', async () => {
  const other = { ...company, uuid: 'company-two', name: 'Second company' };
  rows = [company, other];
  show();
  expect(await screen.findByText('Choose a company above.')).toBeTruthy();
  expect(api.get.mock.calls.some(([url]) => url === DETAIL)).toBe(false);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: company.uuid } });
  await confirm();
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  expect(api.post.mock.calls[0][0]).toBe(DETAIL + 'activate/');
});

it.each([LIST, DETAIL])('reports and retries a failed %s read without an absent-company claim', async (endpoint) => {
  failed = endpoint;
  show();
  const retry = await screen.findByRole('button', { name: 'Retry company information' });
  expect(screen.queryByText(/A current personal administrator appointment is required/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Review activation' })).toBeNull();
  failed = null;
  fireEvent.click(retry);
  expect(await screen.findByRole('button', { name: 'Review activation' })).toBeTruthy();
});

it('shows historical dates and reasons without normal review or withdrawal controls', async () => {
  company = {
    ...company,
    status: 'info_required',
    submittedAt: '2026-09-01T00:00:00Z',
    infoRequestedAt: '2026-09-03T00:00:00Z',
    infoRequestReason: 'Retained request',
    additionalInfoResponse: 'Retained response',
  };
  rows = [company];
  show();
  expect(await screen.findByText('3 September 2026')).toBeTruthy();
  expect(screen.getByText('Information requested: Retained request')).toBeTruthy();
  expect(screen.getByText('Previous response: Retained response')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Resubmit application|Withdraw application/ })).toBeNull();
  expect(screen.getByRole('link', { name: 'Company information and retained documents' })).toBeTruthy();
});

it.each(['appointment', 'lifecycleRevision', 'declarationText', 'declarationVersion'] as const)(
  'retires an open confirmation when fresh %s changes',
  async (field) => {
    show();
    const dialog = await review();
    const changed = { ...company.activation!, [field]: field === 'lifecycleRevision' ? 3 : 'changed' };
    act(() => client.setQueryData(detailKey(), { ...company, activation: changed }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(dialog.isConnected).toBe(false);
    expect(api.post).not.toHaveBeenCalled();
  },
);

it('disposes an open declaration immediately on fresh list-only personal capability loss, without switching company', async () => {
  show();
  await review();
  act(() =>
    client.setQueryData(listKey(), [{ ...company, administrativeAccess: { capabilities: [], draftSetup: false } }]),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByText('Synthetic current declaration')).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

it('requires a new declaration acceptance after cancellation and reopening', async () => {
  show();
  const old = await review();
  fireEvent.click(within(old).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Review activation' }));
  const dialog = await screen.findByRole('dialog');
  expect((within(dialog).getByRole('button', { name: 'Confirm activation' }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.post).not.toHaveBeenCalled();
});

it('sends once for same-tick duplicate confirmation and ignores a delayed old-account receipt', async () => {
  let release!: (value: unknown) => void;
  api.post.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  show();
  const dialog = await review();
  const button = within(dialog).getByRole('button', { name: 'Confirm activation' });
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  const guard = api.post.mock.calls[0][2].ledovaSubmissionGuard;
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  act(() =>
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: {
        ...companyPreferences('investor'),
        userProfile: 'profile-two',
        userAccount: { ...companyPreferences('investor').userAccount!, uuid: 'account-two' },
      },
    }),
  );
  expect(guard).toThrow();
  await act(async () => release({ status: 200, data: { company, attempt: attempt() } }));
  expect(invalidate).not.toHaveBeenCalled();
});

it('retries an interrupted response with the same key and issues a new key after changed source terms', async () => {
  api.post.mockRejectedValueOnce(new Error('Interrupted response'));
  show();
  await confirm();
  expect(await screen.findByText('Interrupted response')).toBeTruthy();
  await confirm();
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect(api.post.mock.calls[0][1]).toEqual(api.post.mock.calls[1][1]);
  expect(await screen.findByText(/The ABR lookup is not configured/)).toBeTruthy();
});

it.each(['company', 'idempotencyKey', 'appointment', 'lifecycleRevision', 'declarationText'] as const)(
  'rejects a mismatched %s activation receipt without cache invalidation',
  async (field) => {
    api.post.mockImplementation(async () => ({
      status: 200,
      data: {
        company: field === 'company' ? { ...company, uuid: 'foreign-company' } : company,
        attempt: {
          ...attempt(),
          ...(field === 'company' ? {} : { [field]: field === 'lifecycleRevision' ? 3 : 'foreign' }),
        },
      },
    }));
    show();
    const dialog = await review();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm activation' }));
    expect(await screen.findByText(/The activation outcome could not be confirmed/)).toBeTruthy();
    expect(invalidate).not.toHaveBeenCalled();
  },
);

it('displays current identity refusal and never reports it as activation', async () => {
  api.post.mockRejectedValueOnce({
    response: {
      status: 400,
      data: { code: 'issuer_identity_verification_required', detail: 'Verify your own identity.' },
    },
  });
  show();
  await confirm();
  expect(await screen.findByText('Verify your own identity.')).toBeTruthy();
  expect(screen.getByText('Identity verification required')).toBeTruthy();
  expect(screen.queryByText('This company is active.')).toBeNull();
});

it('refreshes a genuine applied receipt and shows Active without creating staff approval history', async () => {
  api.post.mockImplementation(async () => {
    const applied = attempt({ status: 'passed', reason: 'matched', appliedAt: '2026-10-05T01:00:02Z' });
    company = {
      ...company,
      status: 'active',
      statusDisplay: 'Active',
      activatedAt: applied.appliedAt,
      activation: { ...company.activation!, lifecycleRevision: 3, latestAttempt: applied },
    };
    rows = [company];
    return { status: 200, data: { company, attempt: applied } };
  });
  show();
  await confirm();
  expect(await screen.findByText('This company is active.')).toBeTruthy();
  expect(screen.getByText(/Activation was applied/)).toBeTruthy();
  expect(screen.queryByText('Approved')).toBeNull();
  expect(screen.queryByRole('button', { name: /Review activation|Try activation again/ })).toBeNull();
});

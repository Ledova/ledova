import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { ApiClientProvider, type Company, type CompanyActivationAttempt } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { invalidateSessionScope } from '../../services/sessionScope';
import { companyDetail, companyQueryClient } from '../../testSupport/companyAdministration';
import { ListingScreen } from '.';

const mockNavigate = jest.fn();
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const LIST = '/api/v1/companies/';
const DETAIL = LIST + 'company-a/';
const KEY = '70000000-0000-4000-8000-000000000001';
const SECOND_KEY = '70000000-0000-4000-8000-000000000002';
const APPOINTMENT = '80000000-0000-4000-8000-000000000001';
let company: Company;
let rows: Company[];
let client: QueryClient;
let failure: string | null;
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
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  failure = null;
  company = companyDetail({
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
  client = companyQueryClient('investor');
  get.mockReset().mockImplementation(async (url) => {
    if (url === failure) throw new Error('Read refused');
    if (url === LIST) return { data: { results: rows, next: null } };
    if (url === DETAIL) return { data: { ...company } };
    throw new Error(`Unexpected ${url}`);
  });
  post.mockReset().mockImplementation(async () => {
    company = { ...company, activation: { ...company.activation!, latestAttempt: attempt() } };
    rows = [company];
    return { status: 200, data: { company, attempt: attempt(), message: 'Activation check recorded.' } };
  });
  jest.mocked(Crypto.randomUUID).mockReset().mockReturnValue(KEY);
  mockNavigate.mockReset();
});
afterEach(async () => {
  await cleanup();
  client.clear();
});
function detailKey() {
  return client.getQueryCache().findAll({ queryKey: ['company', company.uuid] })[0]!.queryKey;
}
function listKey() {
  return client.getQueryCache().findAll({ queryKey: ['companies'] })[0]!.queryKey;
}
async function review(view: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(await view.findByRole('button', { name: /Review activation|Try activation again/ }));
  await fireEvent.press(await view.findByRole('button', { name: 'I accept this declaration for this company.' }));
}
async function confirm(view: Awaited<ReturnType<typeof render>>) {
  await review(view);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm activation' }));
}
function retainedPress(view: Awaited<ReturnType<typeof render>>, name: string) {
  const button = view.getByRole('button', { name });
  let fiber: typeof button.unstable_fiber | null = button.unstable_fiber;
  while (fiber && typeof fiber.memoizedProps?.onPress !== 'function') fiber = fiber.return;
  const callback = fiber?.memoizedProps.onPress;
  expect(typeof callback).toBe('function');
  return callback;
}

it('records activation from an investor-role nonowner appointment without operator review or required uploads', async () => {
  const view = await render(<ListingScreen />, { wrapper });
  await confirm(view);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post).toHaveBeenCalledWith(
    DETAIL + 'activate/',
    {
      idempotencyKey: KEY,
      appointment: APPOINTMENT,
      lifecycleRevision: 2,
      declarationVersion: '2026-10-04',
      acceptDeclaration: true,
    },
    expect.objectContaining({ ledovaSessionEpoch: expect.any(Number), ledovaSubmissionGuard: expect.any(Function) }),
  );
  expect(await view.findByText(/The ABR lookup is not configured/)).toBeTruthy();
  expect(view.queryByText('Required documents')).toBeNull();
  expect(view.queryByRole('button', { name: 'Submit application' })).toBeNull();
  expect(get.mock.calls.some(([url]) => url === '/api/operator/')).toBe(false);
  await fireEvent.press(view.getByRole('button', { name: 'Open your profile' }));
  expect(mockNavigate).toHaveBeenCalledWith('Profile');
});

it.each([
  ['draft owner', { capabilities: [], draftSetup: true }, true],
  ['delegatable-only appointment', { capabilities: [], draftSetup: false }, false],
  ['owner without appointment', { capabilities: [], draftSetup: false }, true],
] as const)('refuses %s activation', async (_, access, isOwner) => {
  company = {
    ...company,
    isOwner,
    administrativeAccess: { capabilities: [...access.capabilities], draftSetup: access.draftSetup },
    activation: null,
  };
  rows = [company];
  const view = await render(<ListingScreen />, { wrapper });
  expect(await view.findByText(/A current personal administrator appointment is required/)).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Review activation' })).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('requires explicit selection for multiple companies', async () => {
  rows = [company, { ...company, uuid: 'company-b', name: 'Second company' }];
  const view = await render(<ListingScreen />, { wrapper });
  expect(await view.findByText('Choose a company above.')).toBeTruthy();
  expect(get.mock.calls.some(([url]) => url === DETAIL)).toBe(false);
  await fireEvent.press(view.getByRole('button', { name: 'Select company Synthetic Company' }));
  await confirm(view);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0][0]).toBe(DETAIL + 'activate/');
});

it.each([LIST, DETAIL])('retains %s read failures and retries without claiming an absent company', async (endpoint) => {
  failure = endpoint;
  const view = await render(<ListingScreen />, { wrapper });
  const retry = await view.findByRole('button', { name: 'Retry company information' });
  expect(view.queryByText(/A current personal administrator appointment is required/)).toBeNull();
  expect(view.queryByRole('button', { name: 'Review activation' })).toBeNull();
  failure = null;
  await fireEvent.press(retry);
  expect(await view.findByRole('button', { name: 'Review activation' })).toBeTruthy();
});

it('preserves historical records without staff review actions', async () => {
  company = {
    ...company,
    status: 'info_required',
    submittedAt: '2026-09-01T00:00:00Z',
    infoRequestedAt: '2026-09-03T00:00:00Z',
    infoRequestReason: 'Retained request',
    additionalInfoResponse: 'Retained response',
  };
  rows = [company];
  const view = await render(<ListingScreen />, { wrapper });
  expect(await view.findByText('3 September 2026')).toBeTruthy();
  expect(view.getByText('Information requested: Retained request')).toBeTruthy();
  expect(view.getByText('Previous response: Retained response')).toBeTruthy();
  expect(view.queryByRole('button', { name: /Resubmit application|Withdraw application/ })).toBeNull();
});

it('retires a cancelled confirmation callback when the same company is reopened, then sends the current callback once', async () => {
  const view = await render(<ListingScreen />, { wrapper });
  await review(view);
  const old = retainedPress(view, 'Confirm activation');
  await fireEvent.press(view.getByRole('button', { name: 'Close dialog' }));
  await review(view);
  await act(() => old());
  expect(post).not.toHaveBeenCalled();
  const current = retainedPress(view, 'Confirm activation');
  await act(() => {
    current();
    current();
  });
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
});

it.each(['appointment', 'lifecycleRevision', 'declarationText', 'declarationVersion'] as const)(
  'refuses a retained confirm callback after fresh %s changes',
  async (field) => {
    const view = await render(<ListingScreen />, { wrapper });
    await review(view);
    const old = retainedPress(view, 'Confirm activation');
    await act(() =>
      client.setQueryData(detailKey(), {
        ...company,
        activation: { ...company.activation!, [field]: field === 'lifecycleRevision' ? 3 : 'changed' },
      }),
    );
    await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm activation' })).toBeNull());
    await act(() => old());
    expect(post).not.toHaveBeenCalled();
  },
);

it('removes declaration and attempt details after fresh list-only capability loss without resurrecting the old callback on regain', async () => {
  company.activation!.latestAttempt = attempt();
  const view = await render(<ListingScreen />, { wrapper });
  await review(view);
  const old = retainedPress(view, 'Confirm activation');
  await act(() =>
    client.setQueryData(listKey(), [{ ...company, administrativeAccess: { capabilities: [], draftSetup: false } }]),
  );
  await waitFor(() => expect(view.queryByText('Synthetic current declaration')).toBeNull());
  expect(view.queryByText(/The ABR lookup is not configured/)).toBeNull();
  await act(() => client.setQueryData(listKey(), [company]));
  await act(() => old());
  expect(post).not.toHaveBeenCalled();
  await review(view);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm activation' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
});

it('retains the same retry key after a lost response but replaces it after actual source terms change', async () => {
  jest.mocked(Crypto.randomUUID).mockReturnValueOnce(KEY).mockReturnValueOnce(SECOND_KEY);
  post.mockRejectedValue(new Error('Interrupted response'));
  const view = await render(<ListingScreen />, { wrapper });
  await confirm(view);
  expect(await view.findByText('Interrupted response')).toBeTruthy();
  await confirm(view);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(post.mock.calls[0][1]).toEqual(post.mock.calls[1][1]);
  company = { ...company, activation: { ...company.activation!, lifecycleRevision: 3 } };
  rows = [company];
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  await confirm(view);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
  expect(post.mock.calls[2][1]).toMatchObject({ idempotencyKey: SECOND_KEY, lifecycleRevision: 3 });
});

it.each(['company', 'appointment', 'idempotencyKey', 'lifecycleRevision', 'declarationText'] as const)(
  'refuses mismatched %s receipt without invalidating current caches',
  async (field) => {
    post.mockImplementation(async () => ({
      status: 200,
      data: {
        company: field === 'company' ? { ...company, uuid: 'foreign-company' } : company,
        attempt: {
          ...attempt(),
          ...(field === 'company' ? {} : { [field]: field === 'lifecycleRevision' ? 3 : 'foreign' }),
        },
      },
    }));
    const view = await render(<ListingScreen />, { wrapper });
    await review(view);
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    await fireEvent.press(view.getByRole('button', { name: 'Confirm activation' }));
    expect(await view.findByText(/The activation outcome could not be confirmed/)).toBeTruthy();
    expect(invalidate).not.toHaveBeenCalled();
  },
);

it('suppresses a delayed outcome after actual session epoch change', async () => {
  let release!: (value: unknown) => void;
  post.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const view = await render(<ListingScreen />, { wrapper });
  await confirm(view);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const guard = post.mock.calls[0][2]!.ledovaSubmissionGuard;
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  await act(() => invalidateSessionScope());
  expect(guard).toThrow();
  await act(() => release({ status: 200, data: { company, attempt: attempt() } }));
  expect(invalidate).not.toHaveBeenCalled();
});

it('shows acting-user identity refusal without claiming success', async () => {
  post.mockRejectedValueOnce({
    response: {
      status: 400,
      data: { code: 'issuer_identity_verification_required', detail: 'Verify your own identity.' },
    },
  });
  const view = await render(<ListingScreen />, { wrapper });
  await confirm(view);
  expect(await view.findByText('Verify your own identity.')).toBeTruthy();
  expect(view.getByText('Identity verification required')).toBeTruthy();
  expect(view.queryByText('This company is active.')).toBeNull();
});

it('shows actual applied activation with no manufactured staff approval date', async () => {
  post.mockImplementation(async () => {
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
  const view = await render(<ListingScreen />, { wrapper });
  await confirm(view);
  expect(await view.findByText('This company is active.')).toBeTruthy();
  expect(view.getByText(/Activation was applied/)).toBeTruthy();
  expect(view.queryByText('Approved')).toBeNull();
  expect(view.queryByRole('button', { name: /Review activation|Try activation again/ })).toBeNull();
});

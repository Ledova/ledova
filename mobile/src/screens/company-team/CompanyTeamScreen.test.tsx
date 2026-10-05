import React from 'react';
import { Alert } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  type CreateCompanyTeamInvitationRequest,
  type OwnCompanyAppointment,
  type CompanyTeamAppointment,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { importAppointmentsKey } from '../company-register/useCompanyRegister';
import { CompanyTeamScreen } from './CompanyTeamScreen';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));

const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const INVITATIONS = '/api/v1/company-authority/invitations/';
const code = 'S'.repeat(43);
const a: OwnCompanyAppointment = {
  uuid: 'appointment-a',
  company: 'company-a',
  companyName: 'Synthetic Company A',
  source: 'initial',
  capabilities: ['admin', 'prepare'],
  delegatableCapabilities: ['admin', 'prepare', 'approve'],
  createdAt: '2026-10-04T00:00:00Z',
  expiresAt: null,
  revokedAt: null,
  isEffective: true,
  status: 'active',
  declarationText: COMPANY_AUTHORITY_DECLARATION,
  declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION,
};
const b: OwnCompanyAppointment = {
  ...a,
  uuid: 'appointment-b',
  company: 'company-b',
  companyName: 'Synthetic Company B',
  source: 'invitation',
  capabilities: ['prepare'],
  delegatableCapabilities: ['admin', 'finance'],
};
const other: CompanyTeamAppointment = {
  uuid: 'appointment-other',
  company: a.company,
  name: 'Synthetic Teammate',
  email: 'teammate@example.test',
  source: 'invitation',
  capabilities: ['prepare'],
  delegatableCapabilities: ['approve'],
  createdAt: a.createdAt,
  expiresAt: null,
  revokedAt: null,
  status: 'active',
  isEffective: true,
};
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
let client: QueryClient;
let history: OwnCompanyAppointment[];
let teamHistory: CompanyTeamAppointment[];
let failure: string | null;
let sequence: number;
const settle: (() => void)[] = [];

function deferred<T>(fallback: T) {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  settle.push(() => resolve(fallback));
  return { promise, resolve, reject };
}

function invitation(input: CreateCompanyTeamInvitationRequest, oneTimeCode: string | null = code) {
  return {
    uuid: 'invitation-a',
    company: input.company,
    companyName: input.company === a.company ? a.companyName : b.companyName,
    inviterAppointment: input.inviterAppointment,
    idempotencyKey: input.idempotencyKey,
    capabilities: input.capabilities,
    delegatableCapabilities: input.delegatableCapabilities ?? [],
    acceptanceDeadline: input.acceptanceDeadline ?? '2026-10-11T00:00:00Z',
    appointmentExpiresAt: input.appointmentExpiresAt ?? null,
    createdAt: a.createdAt,
    acceptedAt: null,
    code: oneTimeCode,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

function switchAccount() {
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'profile-b', userAccount: { uuid: 'account-b', role: 'investor' } },
  });
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'profile-a', userAccount: { uuid: 'account-a', role: 'investor' } },
  });
  history = [{ ...a }, { ...b }];
  teamHistory = [{ ...other }];
  failure = null;
  sequence = 0;
  jest
    .mocked(Crypto.randomUUID)
    .mockImplementation(() => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  get.mockReset().mockImplementation(async (url, config) => {
    config?.ledovaSubmissionGuard?.();
    if (url === failure) throw new Error('Synthetic read failure');
    if (url === APPOINTMENTS) {
      const page = (config?.params as { page?: number })?.page ?? 1;
      return {
        data: {
          results: page === 1 ? history.slice(0, 1) : history.slice(1),
          count: history.length,
          next: page === 1 && history.length > 1 ? 'https://example.test/appointments/?page=2' : null,
        },
      };
    }
    if (url === INVITATIONS) return { data: { results: [], count: 0, next: null } };
    if (url === `${APPOINTMENTS}team/`) return { data: teamHistory };
    throw new Error(`Unexpected read ${url}`);
  });
  post.mockReset().mockImplementation(async (url, input, config) => {
    config?.ledovaSubmissionGuard?.();
    if (url === INVITATIONS) return { status: 201, data: invitation(input as CreateCompanyTeamInvitationRequest) };
    if (url === `${INVITATIONS}accept/`) {
      const appointment = { ...b, uuid: 'accepted-appointment' };
      history = [...history, appointment];
      return { data: appointment };
    }
    if (url === `${APPOINTMENTS}appointment-a/revoke/` || url === `${APPOINTMENTS}appointment-other/revoke/`) {
      const target = url.includes('appointment-other') ? { ...a, ...other } : a;
      const revoked = { ...target, status: 'revoked' as const, isEffective: false, revokedAt: '2026-10-04T01:00:00Z' };
      history = history.map((item) => (item.uuid === revoked.uuid ? revoked : item));
      teamHistory = teamHistory.map((item) => (item.uuid === revoked.uuid ? { ...item, ...revoked } : item));
      return { data: revoked };
    }
    throw new Error(`Unexpected write ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
  await act(() => settle.splice(0).forEach((finish) => finish()));
  client.clear();
});

async function screen() {
  const view = await render(<CompanyTeamScreen />, { wrapper });
  await view.findByRole('button', { name: 'Your appointment appointment-b' });
  return view;
}

async function chooseSource(view: Awaited<ReturnType<typeof screen>>, source = a) {
  await fireEvent.press(view.getByRole('radio', { name: `Select company ${source.companyName}` }));
  await fireEvent.press(view.getByRole('radio', { name: `Select source appointment ${source.uuid}` }));
}

function alertButtons() {
  return jest.mocked(Alert.alert).mock.calls.at(-1)![2]!;
}

it('requires an authenticated account before reading or presenting team forms', async () => {
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
  const view = await render(<CompanyTeamScreen />, { wrapper });
  expect(
    view.getByText('Verify your signed-in account before accepting invitations or managing appointments.'),
  ).toBeTruthy();
  expect(view.queryByLabelText('Invitation code')).toBeNull();
  expect(get).not.toHaveBeenCalled();
});

it.each(['active', 'expired'] as const)(
  'retains and revokes %s legacy-owner history without inventing a declaration',
  async (status) => {
    const legacy: OwnCompanyAppointment = {
      ...a,
      source: 'legacy_owner',
      declarationVersion: null,
      declarationText: null,
      status,
      isEffective: status === 'active',
      expiresAt: status === 'expired' ? '2020-01-01T00:00:00Z' : null,
    };
    history = [legacy, b];
    const view = await screen();
    await fireEvent.press(view.getByRole('button', { name: 'Your appointment appointment-a' }));
    const record = within(view.getByRole('button', { name: 'Your appointment appointment-a' }));
    expect(record.getByText(/Legacy company owner/)).toBeTruthy();
    expect(view.getAllByText(COMPANY_AUTHORITY_DECLARATION)).toHaveLength(1);
    expect(view.queryByText(/Recorded declaration version/)).toBeNull();
    if (status === 'active') {
      await chooseSource(view, legacy);
      expect(view.getByRole('radio', { name: `Select source appointment ${legacy.uuid}` })).toHaveTextContent(
        /Legacy owner appointment/,
      );
    }
    const revoked = { ...legacy, status: 'revoked' as const, isEffective: false, revokedAt: '2026-10-04T01:00:00Z' };
    post.mockImplementationOnce(async (url, _, config) => {
      config?.ledovaSubmissionGuard?.();
      expect(url).toBe(`${APPOINTMENTS}${legacy.uuid}/revoke/`);
      history = history.map((item) => (item.uuid === legacy.uuid ? revoked : item));
      return { data: revoked };
    });
    await fireEvent.press(view.getByRole('button', { name: 'Revoke your appointment appointment-a' }));
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)![1]).toContain(
      'Another initial self-declaration cannot replace it',
    );
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)![1]).not.toContain('Its declaration');
    await act(alertButtons()[1].onPress!);
    await waitFor(() => expect(record.getByText(/revoked · Not current · Legacy company owner/)).toBeTruthy());
    expect(view.queryByText(/Recorded declaration version/)).toBeNull();
    expect(view.getAllByText(COMPANY_AUTHORITY_DECLARATION)).toHaveLength(1);
  },
);

it('labels a bounded legacy-owner team record without attributing a declaration', async () => {
  teamHistory = [{ ...other, source: 'legacy_owner' }];
  const view = await screen();
  await fireEvent.press(view.getByRole('radio', { name: `Select company ${a.companyName}` }));
  await fireEvent.press(await view.findByRole('button', { name: 'Team appointment appointment-other' }));
  const record = within(view.getByRole('button', { name: 'Team appointment appointment-other' }));
  expect(record.getByText(/Legacy company owner/)).toBeTruthy();
  expect(view.getByText(other.email)).toBeTruthy();
  expect(view.queryByText(/Recorded declaration version/)).toBeNull();
  expect(view.getAllByText(COMPANY_AUTHORITY_DECLARATION)).toHaveLength(1);
});

it('refuses a legacy-owner response from invitation acceptance', async () => {
  const view = await screen();
  await fireEvent.changeText(view.getByLabelText('Invitation code'), code);
  await fireEvent.press(view.getByRole('checkbox', { name: 'Accept authorisation declaration' }));
  post.mockResolvedValueOnce({
    data: { ...a, source: 'legacy_owner', declarationVersion: null, declarationText: null },
  });
  await fireEvent.press(view.getByRole('button', { name: 'Accept invitation' }));
  await view.findByText('The invitation could not be accepted. Check the code and account requirements, then retry.');
  expect(view.queryByText(/Appointment recorded for/)).toBeNull();
  expect(view.getByLabelText('Invitation code').props.value).toBe(code);
});

it('retains expired and non-current own history without offering either as a delegation source', async () => {
  history = [
    { ...a, isEffective: false },
    { ...b, status: 'expired', isEffective: false },
  ];
  const view = await screen();
  await fireEvent.press(view.getByRole('radio', { name: `Select company ${a.companyName}` }));
  expect(view.queryByRole('radio', { name: `Select source appointment ${a.uuid}` })).toBeNull();
  await fireEvent.press(view.getByRole('radio', { name: `Select company ${b.companyName}` }));
  expect(view.queryByRole('radio', { name: `Select source appointment ${b.uuid}` })).toBeNull();
  expect(view.getByRole('button', { name: 'Your appointment appointment-a' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Your appointment appointment-b' })).toBeTruthy();
  expect(get.mock.calls.some(([url]) => url === `${APPOINTMENTS}team/`)).toBe(false);
});

it('reads every inviter-private history page and shows retained outcome/scope/deadline without codes', async () => {
  const input = {
    company: a.company,
    inviterAppointment: a.uuid,
    idempotencyKey: 'retained-key',
    capabilities: ['prepare'] as const,
  };
  const { code: _discardedCode, ...first } = invitation({ ...input, capabilities: [...input.capabilities] });
  const second = { ...first, uuid: 'retained-second', acceptedAt: '2026-10-04T01:00:00Z' };
  const original = get.getMockImplementation()!;
  get.mockImplementation(async (url, config) => {
    if (url === INVITATIONS) {
      const page = (config?.params as { page?: number })?.page ?? 1;
      return {
        data: {
          results: [page === 1 ? first : second],
          count: 2,
          next: page === 1 ? 'https://example.test/invitations/?page=2' : null,
        },
      };
    }
    return original(url, config);
  });
  const view = await screen();
  expect(await view.findByText('retained-second')).toBeTruthy();
  expect(view.getByText('Accepted')).toBeTruthy();
  expect(view.getByText('Not accepted')).toBeTruthy();
  expect(view.getAllByText('Accept before')).toHaveLength(2);
  expect(view.queryByLabelText('One-time invitation code')).toBeNull();
  expect(get.mock.calls.filter(([url]) => url === INVITATIONS).map(([, config]) => config?.params)).toEqual([
    { page: 1 },
    { page: 2 },
  ]);
});

it.each([
  [200, code],
  [201, null],
  [202, null],
] as const)('rejects an inconsistent issue HTTP/code receipt (%s)', async (status, returnedCode) => {
  const view = await screen();
  await chooseSource(view);
  await fireEvent.press(
    view.getByRole('checkbox', {
      name: 'Permissions to exercise: Prepare register changes (includes reading the register)',
    }),
  );
  post.mockImplementationOnce(async (_, input) => ({
    status,
    data: invitation(input as CreateCompanyTeamInvitationRequest, returnedCode),
  }));
  await fireEvent.press(view.getByRole('button', { name: 'Create invitation' }));
  await view.findByText('The invitation could not be confirmed. Retry with the same details.');
  expect(view.queryByLabelText('One-time invitation code')).toBeNull();
  expect(view.queryByText(/This invitation was already recorded/)).toBeNull();
});

it('preserves the current appointment after a wrong revocation receipt and requires a fresh confirmed retry', async () => {
  const view = await screen();
  await fireEvent.press(view.getByRole('button', { name: 'Your appointment appointment-a' }));
  await fireEvent.press(view.getByRole('button', { name: 'Revoke your appointment appointment-a' }));
  post.mockResolvedValueOnce({
    data: { ...a, uuid: 'wrong-target', status: 'revoked', isEffective: false, revokedAt: '2026-10-04T01:00:00Z' },
  });
  await act(alertButtons()[1].onPress!);
  await view.findByText('The revocation could not be confirmed. Refresh or confirm a retry.');
  const records = client.getQueryData<OwnCompanyAppointment[]>([
    'company-team',
    'profile-a',
    'account-a',
    getSessionEpoch(),
    'appointments',
  ]);
  expect(records?.find((record) => record.uuid === a.uuid)?.status).toBe('active');
  await fireEvent.press(view.getByRole('button', { name: 'Revoke your appointment appointment-a' }));
  await act(alertButtons()[1].onPress!);
  await waitFor(() => expect(view.queryByRole('button', { name: 'Revoke your appointment appointment-a' })).toBeNull());
  expect(post).toHaveBeenCalledTimes(2);
});

it('offers admin from a delegating source when a separate current personal appointment administers that company', async () => {
  const delegated = { ...b, company: a.company, companyName: a.companyName };
  history = [a, delegated];
  const view = await screen();
  await chooseSource(view, delegated);
  await fireEvent.press(
    view.getByRole('checkbox', { name: 'Permissions to delegate: Manage company information and team' }),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Create invitation' }));
  await view.findByLabelText('One-time invitation code');
  expect(post).toHaveBeenCalledWith(
    INVITATIONS,
    expect.objectContaining({
      company: a.company,
      inviterAppointment: delegated.uuid,
      capabilities: [],
      delegatableCapabilities: ['admin'],
    }),
    expect.anything(),
  );
});

it('uses a fresh issue key when refused invitation details change', async () => {
  const view = await screen();
  await chooseSource(view);
  await fireEvent.press(
    view.getByRole('checkbox', {
      name: 'Permissions to exercise: Prepare register changes (includes reading the register)',
    }),
  );
  post.mockRejectedValueOnce(new Error('Synthetic issue refusal'));
  await fireEvent.press(view.getByRole('button', { name: 'Create invitation' }));
  await view.findByText('The invitation could not be confirmed. Retry with the same details.');
  const first = post.mock.calls[0][1] as CreateCompanyTeamInvitationRequest;
  await fireEvent.press(
    view.getByRole('checkbox', {
      name: 'Permissions to delegate: Approve register changes (includes reading the register)',
    }),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Create invitation' }));
  await view.findByLabelText('One-time invitation code');
  const changed = post.mock.calls[1][1] as CreateCompanyTeamInvitationRequest;
  expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
  expect(changed.delegatableCapabilities).toEqual(['approve']);
});

it('blocks duplicate issuing and suppresses a late one-time code after an account switch', async () => {
  const view = await screen();
  await chooseSource(view);
  await fireEvent.press(
    view.getByRole('checkbox', {
      name: 'Permissions to exercise: Prepare register changes (includes reading the register)',
    }),
  );
  const response = deferred({
    status: 201,
    data: invitation({
      company: a.company,
      inviterAppointment: a.uuid,
      idempotencyKey: 'fallback',
      capabilities: ['prepare'],
    }),
  });
  post.mockReturnValueOnce(response.promise);
  await fireEvent.press(view.getByRole('button', { name: 'Create invitation' }));
  await fireEvent.press(view.getByRole('button', { name: 'Creating invitation…' }));
  expect(post).toHaveBeenCalledTimes(1);
  const input = post.mock.calls[0][1] as CreateCompanyTeamInvitationRequest;
  const config = post.mock.calls[0][2]!;
  await act(switchAccount);
  expect(() => config.ledovaSubmissionGuard?.()).toThrow('Your account changed');
  await act(() => response.resolve({ status: 201, data: invitation(input) }));
  expect(view.queryByLabelText('One-time invitation code')).toBeNull();
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain(code);
});

it('compares exact date instants rather than rejecting the server timestamp formatting', async () => {
  const view = await screen();
  await chooseSource(view);
  await fireEvent.press(
    view.getByRole('checkbox', {
      name: 'Permissions to exercise: Prepare register changes (includes reading the register)',
    }),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Choose acceptance deadline date' }));
  await fireEvent(
    view.getByTestId('team-date-Acceptance deadline'),
    'change',
    { type: 'set' },
    new Date('2026-10-10T00:00:00.000Z'),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Done choosing acceptance deadline' }));
  post.mockImplementationOnce(async (_, input) => ({
    status: 201,
    data: {
      ...invitation(input as CreateCompanyTeamInvitationRequest),
      acceptanceDeadline: '2026-10-10T00:00:00Z',
    },
  }));
  await fireEvent.press(view.getByRole('button', { name: 'Create invitation' }));
  expect(await view.findByLabelText('One-time invitation code')).toHaveTextContent(code);
});

it('rejects a cancelled native callback after a new confirmation opens and accepts only the fresh one', async () => {
  const view = await screen();
  await fireEvent.press(view.getByRole('button', { name: 'Your appointment appointment-a' }));
  await fireEvent.press(view.getByRole('button', { name: 'Revoke your appointment appointment-a' }));
  const old = alertButtons();
  await act(() => old[0].onPress?.());
  await fireEvent.press(view.getByRole('button', { name: 'Revoke your appointment appointment-a' }));
  const fresh = alertButtons();
  await act(() => {
    old[0].onPress?.();
    old[1].onPress?.();
  });
  expect(post).not.toHaveBeenCalled();
  await act(() => fresh[1].onPress?.());
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
});

it('invalidates a native confirmation as soon as its appointment read starts refreshing', async () => {
  const view = await screen();
  await fireEvent.press(view.getByRole('button', { name: 'Your appointment appointment-a' }));
  await fireEvent.press(view.getByRole('button', { name: 'Revoke your appointment appointment-a' }));
  const confirm = alertButtons()[1].onPress!;
  const response = deferred({ data: { results: history, count: history.length, next: null } });
  const original = get.getMockImplementation()!;
  get.mockImplementation((url, config) => (url === APPOINTMENTS ? response.promise : original(url, config)));
  await fireEvent.press(view.getByRole('button', { name: 'Refresh' }));
  await waitFor(() =>
    expect(view.getByRole('button', { name: 'Revoke your appointment appointment-a' })).toBeDisabled(),
  );
  await act(confirm);
  expect(post).not.toHaveBeenCalled();
  await act(() => response.resolve({ data: { results: history, count: history.length, next: null } }));
});

it('loads all own appointment pages for an investor without querying global companies or private evidence', async () => {
  const view = await screen();
  expect(get.mock.calls.filter(([url]) => url === APPOINTMENTS).map(([, config]) => config?.params)).toEqual([
    { page: 1 },
    { page: 2 },
  ]);
  expect(get.mock.calls.every(([url]) => String(url).startsWith('/api/v1/company-authority/'))).toBe(true);
  expect(view.getByRole('button', { name: 'Your appointment appointment-a' })).toBeTruthy();
  expect(view.getByText(/full appointment history/)).toBeTruthy();
  expect(view.queryByText('Synthetic Teammate')).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('uses the explicit company/source and allows onward delegation without personally granting it', async () => {
  const view = await screen();
  await chooseSource(view);
  expect(view.getByRole('button', { name: 'Create invitation' })).toBeDisabled();
  await fireEvent.press(
    view.getByRole('checkbox', {
      name: 'Permissions to delegate: Approve register changes (includes reading the register)',
    }),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Create invitation' }));
  expect(await view.findByLabelText('One-time invitation code')).toHaveTextContent(code);
  expect(post).toHaveBeenCalledWith(
    INVITATIONS,
    expect.objectContaining({
      company: a.company,
      inviterAppointment: a.uuid,
      capabilities: [],
      delegatableCapabilities: ['approve'],
    }),
    expect.objectContaining({ ledovaSessionEpoch: getSessionEpoch(), ledovaSubmissionGuard: expect.any(Function) }),
  );
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain(code);
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  await fireEvent.press(view.getByRole('button', { name: 'Create another invitation' }));
  expect(view.queryByLabelText('One-time invitation code')).toBeNull();
});

it('offers only the source delegation scope and hides team administration when personal admin is absent', async () => {
  const view = await screen();
  await chooseSource(view, b);
  expect(
    view.queryByRole('checkbox', { name: 'Permissions to exercise: Manage company information and team' }),
  ).toBeNull();
  expect(
    view.queryByRole('checkbox', { name: 'Permissions to delegate: Manage company information and team' }),
  ).toBeNull();
  expect(
    view.queryByRole('checkbox', {
      name: 'Permissions to exercise: Prepare register changes (includes reading the register)',
    }),
  ).toBeNull();
  expect(view.getByRole('checkbox', { name: 'Permissions to exercise: Manage company payments' })).toBeTruthy();
  expect(get.mock.calls.some(([url]) => url === `${APPOINTMENTS}team/`)).toBe(false);
  expect(view.queryByText(other.email)).toBeNull();
});

it('retains an interrupted issue key and handles a code-null retry without pretending to recover the code', async () => {
  const view = await screen();
  await chooseSource(view);
  await fireEvent.press(
    view.getByRole('checkbox', {
      name: 'Permissions to exercise: Prepare register changes (includes reading the register)',
    }),
  );
  post.mockRejectedValueOnce(new Error('Interrupted response'));
  await fireEvent.press(view.getByRole('button', { name: 'Create invitation' }));
  await view.findByText('The invitation could not be confirmed. Retry with the same details.');
  const input = post.mock.calls[0][1] as CreateCompanyTeamInvitationRequest;
  post.mockResolvedValueOnce({ status: 200, data: invitation(input, null) });
  await fireEvent.press(view.getByRole('button', { name: 'Create invitation' }));
  expect(await view.findByText(/This invitation was already recorded/)).toBeTruthy();
  expect(post.mock.calls[1][1]).toEqual(input);
  expect(view.queryByLabelText('One-time invitation code')).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Create another invitation' }));
  await fireEvent.press(
    view.getByRole('checkbox', {
      name: 'Permissions to delegate: Approve register changes (includes reading the register)',
    }),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Create invitation' }));
  expect((post.mock.calls[2][1] as CreateCompanyTeamInvitationRequest).idempotencyKey).not.toBe(input.idempotencyKey);
});

it('rejects a mismatched invitation receipt without displaying or caching its code', async () => {
  const view = await screen();
  await chooseSource(view);
  await fireEvent.press(
    view.getByRole('checkbox', {
      name: 'Permissions to exercise: Prepare register changes (includes reading the register)',
    }),
  );
  post.mockImplementationOnce(async (_, input) => ({
    status: 201,
    data: { ...invitation(input as CreateCompanyTeamInvitationRequest), company: b.company },
  }));
  await fireEvent.press(view.getByRole('button', { name: 'Create invitation' }));
  await view.findByText('The invitation could not be confirmed. Retry with the same details.');
  expect(view.queryByLabelText('One-time invitation code')).toBeNull();
});

it('requires the exact declaration and shows actionable provider refusal before a successful acceptance', async () => {
  const view = await screen();
  expect(view.getByText(COMPANY_AUTHORITY_DECLARATION)).toBeTruthy();
  await fireEvent.changeText(view.getByLabelText('Invitation code'), code);
  await fireEvent.press(view.getByRole('button', { name: 'Accept invitation' }));
  expect(post).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('checkbox', { name: 'Accept authorisation declaration' }));
  post.mockRejectedValueOnce({
    response: { status: 503, data: { detail: 'The identity provider is unavailable. Retry later.' } },
  });
  await fireEvent.press(view.getByRole('button', { name: 'Accept invitation' }));
  expect(await view.findByText('The identity provider is unavailable. Retry later.')).toBeTruthy();
  expect(view.getByLabelText('Invitation code').props.value).toBe(code);
  await fireEvent.press(view.getByRole('button', { name: 'Accept invitation' }));
  await view.findByText(/Appointment recorded for Synthetic Company B/);
  expect(post).toHaveBeenLastCalledWith(
    `${INVITATIONS}accept/`,
    {
      code,
      declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION,
      acceptDeclaration: true,
    },
    expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
  );
  expect(view.getByLabelText('Invitation code').props.value).toBe('');
  expect(view.getByRole('checkbox', { name: 'Accept authorisation declaration' })).not.toBeChecked();
  expect(await view.findByRole('button', { name: 'Your appointment accepted-appointment' })).toBeTruthy();
});

it('invalidates declaration agreement when the code changes and refuses a mismatched acceptance receipt', async () => {
  const view = await screen();
  await fireEvent.changeText(view.getByLabelText('Invitation code'), code);
  await fireEvent.press(view.getByRole('checkbox', { name: 'Accept authorisation declaration' }));
  await fireEvent.changeText(view.getByLabelText('Invitation code'), 'T'.repeat(43));
  expect(view.getByRole('button', { name: 'Accept invitation' })).toBeDisabled();
  await fireEvent.press(view.getByRole('checkbox', { name: 'Accept authorisation declaration' }));
  post.mockResolvedValueOnce({ data: a });
  await fireEvent.press(view.getByRole('button', { name: 'Accept invitation' }));
  await view.findByText('The invitation could not be accepted. Check the code and account requirements, then retry.');
  expect(view.queryByText(/Appointment recorded for/)).toBeNull();
});

it('keeps acceptance acknowledgment historical after the accepted appointment is revoked and refreshed', async () => {
  const original = post.getMockImplementation()!;
  post.mockImplementation(async (url, input, config) => {
    if (url === `${APPOINTMENTS}accepted-appointment/revoke/`) {
      config?.ledovaSubmissionGuard?.();
      const accepted = history.find((record) => record.uuid === 'accepted-appointment')!;
      const revoked = {
        ...accepted,
        status: 'revoked' as const,
        isEffective: false,
        revokedAt: '2026-10-04T01:00:00Z',
      };
      history = history.map((record) => (record.uuid === revoked.uuid ? revoked : record));
      return { data: revoked };
    }
    return original(url, input, config);
  });
  const view = await screen();
  await fireEvent.changeText(view.getByLabelText('Invitation code'), code);
  await fireEvent.press(view.getByRole('checkbox', { name: 'Accept authorisation declaration' }));
  await fireEvent.press(view.getByRole('button', { name: 'Accept invitation' }));
  await view.findByText(/Appointment recorded for Synthetic Company B/);
  await fireEvent.press(await view.findByRole('button', { name: 'Your appointment accepted-appointment' }));
  await fireEvent.press(view.getByRole('button', { name: 'Revoke your appointment accepted-appointment' }));
  await act(alertButtons()[1].onPress!);
  await waitFor(() =>
    expect(view.queryByRole('button', { name: 'Revoke your appointment accepted-appointment' })).toBeNull(),
  );
  await waitFor(() => expect(view.getByRole('button', { name: 'Refresh' })).not.toBeDisabled());
  await fireEvent.press(view.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Refresh' })).not.toBeDisabled());
  const record = within(view.getByRole('button', { name: 'Your appointment accepted-appointment' }));
  expect(record.getByText(/revoked · Not current · Invitation/)).toBeTruthy();
  expect(view.getByText(/Appointment recorded for Synthetic Company B/)).not.toHaveTextContent(
    /\bactive\b|Current authority/,
  );
  expect(view.getByText(/Appointment recorded for Synthetic Company B/)).toHaveTextContent(/accepted-appointment/);
  expect(post.mock.calls.map(([url]) => url)).toEqual([
    `${INVITATIONS}accept/`,
    `${APPOINTMENTS}accepted-appointment/revoke/`,
  ]);
});

it('suppresses duplicate acceptance and retires its code and late receipt on an account change', async () => {
  const view = await screen();
  await fireEvent.changeText(view.getByLabelText('Invitation code'), code);
  await fireEvent.press(view.getByRole('checkbox', { name: 'Accept authorisation declaration' }));
  const response = deferred({ data: b });
  post.mockReturnValueOnce(response.promise);
  await fireEvent.press(view.getByRole('button', { name: 'Accept invitation' }));
  await fireEvent.press(view.getByRole('button', { name: 'Accepting invitation…' }));
  expect(post).toHaveBeenCalledTimes(1);
  const config = post.mock.calls[0][2]!;
  await act(switchAccount);
  expect(() => config.ledovaSubmissionGuard?.()).toThrow('Your account changed');
  await act(() => response.resolve({ data: b }));
  expect(view.queryByText(/Appointment recorded for/)).toBeNull();
  expect(view.getByLabelText('Invitation code').props.value).toBe('');
});

it('retires a one-time issue code and old source callbacks on a session change', async () => {
  const view = await screen();
  await chooseSource(view);
  await fireEvent.press(
    view.getByRole('checkbox', {
      name: 'Permissions to exercise: Prepare register changes (includes reading the register)',
    }),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Create invitation' }));
  await view.findByLabelText('One-time invitation code');
  const config = post.mock.calls[0][2]!;
  await act(() => invalidateSessionScope());
  expect(view.queryByLabelText('One-time invitation code')).toBeNull();
  expect(() => config.ledovaSubmissionGuard?.()).toThrow('The saved session changed');
});

it.each(['Cancel', 'dismiss'] as const)(
  'sends no revocation after %s even if the native callback is retained',
  async (action) => {
    const view = await screen();
    await fireEvent.press(view.getByRole('button', { name: 'Your appointment appointment-a' }));
    await fireEvent.press(view.getByRole('button', { name: 'Revoke your appointment appointment-a' }));
    expect(jest.mocked(Alert.alert).mock.calls.at(-1)![1]).toContain(
      'Another initial self-declaration cannot replace it',
    );
    const buttons = alertButtons();
    await act(() => {
      if (action === 'Cancel') buttons[0].onPress?.();
      else jest.mocked(Alert.alert).mock.calls.at(-1)![3]?.onDismiss?.();
      buttons[1].onPress?.();
    });
    expect(post).not.toHaveBeenCalled();
  },
);

it('consumes confirmation once, updates the actual own appointment receipt and ignores duplicate callbacks', async () => {
  const view = await screen();
  await fireEvent.press(view.getByRole('button', { name: 'Your appointment appointment-a' }));
  await fireEvent.press(view.getByRole('button', { name: 'Revoke your appointment appointment-a' }));
  const confirm = alertButtons()[1].onPress!;
  await act(() => {
    confirm();
    confirm();
  });
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Revoke your appointment appointment-a' })).toBeNull());
  const data = client.getQueryData<OwnCompanyAppointment[]>([
    'company-team',
    'profile-a',
    'account-a',
    getSessionEpoch(),
    'appointments',
  ]);
  expect(data?.find((item) => item.uuid === a.uuid)?.status).toBe('revoked');
  await act(confirm);
  expect(post).toHaveBeenCalledTimes(1);
});

it('makes the register read its import appointments again after a revocation', async () => {
  const view = await screen();
  const key = importAppointmentsKey(getSessionEpoch());
  client.setQueryData(key, [a]);
  await fireEvent.press(view.getByRole('button', { name: 'Your appointment appointment-a' }));
  await fireEvent.press(view.getByRole('button', { name: 'Revoke your appointment appointment-a' }));
  expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  await act(alertButtons()[1].onPress!);
  await waitFor(() => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
});

it('requires a fresh native confirmation after a failed revocation and rejects an old callback after reopening', async () => {
  const view = await screen();
  await fireEvent.press(view.getByRole('button', { name: 'Your appointment appointment-a' }));
  await fireEvent.press(view.getByRole('button', { name: 'Revoke your appointment appointment-a' }));
  const old = alertButtons()[1].onPress!;
  post.mockRejectedValueOnce(new Error('Synthetic revocation failure'));
  await act(old);
  await view.findByText('The revocation could not be confirmed. Refresh or confirm a retry.');
  await act(old);
  expect(post).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByRole('button', { name: 'Revoke your appointment appointment-a' }));
  const fresh = alertButtons()[1].onPress!;
  await act(old);
  expect(post).toHaveBeenCalledTimes(1);
  await act(fresh);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Revoke your appointment appointment-a' })).toBeNull());
});

it('refuses confirmation held across an account change', async () => {
  const view = await screen();
  await fireEvent.press(view.getByRole('button', { name: 'Your appointment appointment-a' }));
  await fireEvent.press(view.getByRole('button', { name: 'Revoke your appointment appointment-a' }));
  const confirm = alertButtons()[1].onPress!;
  await act(switchAccount);
  await act(confirm);
  expect(post).not.toHaveBeenCalled();
});

it('allows actual personal administration to read and permanently revoke a teammate, retaining bounded name/email', async () => {
  const view = await screen();
  await fireEvent.press(view.getByRole('radio', { name: `Select company ${a.companyName}` }));
  await fireEvent.press(await view.findByRole('button', { name: 'Team appointment appointment-other' }));
  expect(view.getByText(other.email)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Revoke team appointment appointment-other' }));
  await act(alertButtons()[1].onPress!);
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      `${APPOINTMENTS}${other.uuid}/revoke/`,
      {},
      expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
    ),
  );
  await waitFor(() =>
    expect(view.queryByRole('button', { name: 'Revoke team appointment appointment-other' })).toBeNull(),
  );
  const data = client.getQueryData<CompanyTeamAppointment[]>([
    'company-team',
    'profile-a',
    'account-a',
    getSessionEpoch(),
    'team',
    a.company,
  ]);
  expect(data?.[0].email).toBe(other.email);
  expect(data?.[0]).not.toHaveProperty('declarationText');
  expect(within(view.getByTestId('company-team-screen')).queryByText('Evidence fingerprint')).toBeNull();
});

it('hides partial appointment pages after a failed second page and retries before offering a source', async () => {
  const original = get.getMockImplementation()!;
  get.mockImplementation(async (url, config) => {
    if (url === APPOINTMENTS && (config?.params as { page?: number })?.page === 2 && failure)
      throw new Error('Second page refused');
    return original(url, config);
  });
  failure = 'second-page';
  const view = await render(<CompanyTeamScreen />, { wrapper });
  await view.findByText('Your appointments could not be loaded.');
  expect(view.queryByRole('radio', { name: `Select company ${a.companyName}` })).toBeNull();
  failure = null;
  await fireEvent.press(view.getByRole('button', { name: 'Retry appointments' }));
  expect(await view.findByRole('button', { name: 'Your appointment appointment-b' })).toBeTruthy();
});

// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  AUTH_ENDPOINTS,
  USER_PROFILE_ENDPOINTS,
  USER_PREFERENCES_ENDPOINTS,
  USER_PREFERENCES_QUERY_KEY,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import UserProfilePage from './user-profile';
import SettingsPage from './settings';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn() }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  useAuth: () => ({ isAuthenticated: true }),
}));
vi.mock('./user-profile/components/IdentityVerificationModal', () => ({
  IdentityVerificationModal: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? <button onClick={onClose}>Close identity review</button> : null,
}));
vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}));

const profile = {
  uuid: 'profile-one',
  fullName: 'Avery Example',
  email: 'avery@example.test',
  phoneCountryCode: '+61',
  phoneNumber: '400000000',
  dateOfBirth: null,
  residentialAddress: null,
  citizenshipCountryName: 'Australia',
  dateJoined: '2026-09-01',
  lastLogin: null,
  isIdVerified: false,
};
const clients: QueryClient[] = [];

function show(page: 'profile' | 'settings') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  clients.push(client);
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  if (page === 'profile')
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: profile.uuid, userAccount: { uuid: 'account-one', role: 'investor' } },
    });
  render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <MemoryRouter>{page === 'profile' ? <UserProfilePage /> : <SettingsPage />}</MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.get.mockImplementation(async (url: string) => {
    if (url === USER_PROFILE_ENDPOINTS.BASE) return { data: { results: [profile], next: null } };
    if (url === USER_PREFERENCES_ENDPOINTS.BASE) return { data: { transactionAlerts: true } };
    if (url === '/api/v1/documents/' || url === '/api/investor-classifications/') return { data: { results: [] } };
    throw new Error(`Unexpected read ${url}`);
  });
  api.patch.mockResolvedValue({ data: profile });
  api.post.mockResolvedValue({ data: {} });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

it('shows profile ledger data and keeps identity review reachable', async () => {
  show('profile');
  expect(await screen.findByText('Avery Example')).toBeTruthy();
  expect(screen.getByText('+61 400000000')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Personal information' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Supporting payslips' })).toBeTruthy();
  expect(await screen.findByText('Click to upload a payslip')).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith('/api/v1/documents/');
  expect(api.get).not.toHaveBeenCalledWith('/api/operator/');
  fireEvent.click(screen.getByRole('button', { name: 'Review identity check' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close identity review' }));
  await waitFor(() =>
    expect(api.get.mock.calls.filter(([url]) => url === USER_PROFILE_ENDPOINTS.BASE)).toHaveLength(2),
  );
});

it('keeps a failed phone edit and its values until a successful retry', async () => {
  api.patch.mockRejectedValueOnce(new Error('synthetic refused edit'));
  show('profile');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit personal details' }));
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '411111111' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save personal details' }));
  expect((await screen.findByRole('alert')).textContent).toContain('could not be saved');
  expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('411111111');
  fireEvent.click(screen.getByRole('button', { name: 'Save personal details' }));
  await waitFor(() => expect(screen.queryByLabelText('Phone number')).toBeNull());
  expect(api.patch).toHaveBeenLastCalledWith(
    USER_PROFILE_ENDPOINTS.DETAIL(profile.uuid),
    {
      fullName: profile.fullName,
      residentialAddress: '',
      phoneCountryCode: '+61',
      phoneNumber: '411111111',
    },
    expect.objectContaining({ signal: expect.any(AbortSignal), ledovaSubmissionGuard: expect.any(Function) }),
  );
});

it('blocks duplicate phone saves and cancellation while the request is pending', async () => {
  let finish!: (value: unknown) => void;
  api.patch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show('profile');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit personal details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save personal details' }));
  expect((await screen.findByRole('button', { name: 'Saving…' })).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
  expect(api.patch).toHaveBeenCalledTimes(1);
  await act(async () => finish({ data: profile }));
});

it('suppresses stale profile details on refresh failure and retries the read', async () => {
  const client = show('profile');
  await screen.findByText('Avery Example');
  api.get.mockRejectedValueOnce(new Error('synthetic unavailable profile'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['userProfiles'] });
  });
  expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
  expect(screen.queryByText('Avery Example')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit personal details' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Avery Example')).toBeTruthy();
});

it('distinguishes an empty profile from a failed read', async () => {
  api.get.mockResolvedValue({ data: { results: [], next: null } });
  show('profile');
  expect(await screen.findByText('No profile data is available.')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit personal details' })).toBeNull();
});

it('preserves an unfinished phone edit across a failed background refresh', async () => {
  const client = show('profile');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit personal details' }));
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '422222222' } });
  api.get.mockRejectedValueOnce(new Error('synthetic background failure'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['userProfiles'] });
  });
  expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
  expect(screen.queryByRole('button', { name: 'Save personal details' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(((await screen.findByLabelText('Phone number')) as HTMLInputElement).value).toBe('422222222');
  expect(api.patch).not.toHaveBeenCalled();
});

it('does not invent a preference or allow a toggle after a failed read', async () => {
  api.get.mockRejectedValueOnce(new Error('synthetic failed preference read'));
  show('settings');
  expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
  expect(screen.queryByRole('switch')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect((await screen.findByRole('switch', { name: 'Transaction alerts' })).getAttribute('aria-checked')).toBe('true');
});

it('retains the confirmed preference when saving fails and allows retry', async () => {
  api.post.mockRejectedValueOnce(new Error('synthetic refused preference'));
  show('settings');
  fireEvent.click(await screen.findByRole('switch', { name: 'Transaction alerts' }));
  expect((await screen.findByRole('alert')).textContent).toContain('could not be saved');
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  api.get.mockResolvedValue({ data: { transactionAlerts: false } });
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false'));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('describes the alerts switch with the sentence beside it', async () => {
  show('settings');
  expect(
    await screen.findByRole('switch', {
      name: 'Transaction alerts',
      description: 'Notifications for transaction status changes.',
    }),
  ).toBeTruthy();
});

it('holds the switch while the preference is saving', async () => {
  let save!: () => void;
  api.post.mockReturnValueOnce(
    new Promise((resolve) => {
      save = () => resolve({ data: {} });
    }),
  );
  show('settings');
  const control = (await screen.findByRole('switch', { name: 'Transaction alerts' })) as HTMLButtonElement;
  fireEvent.click(control);
  await waitFor(() => expect(control.disabled).toBe(true));
  expect(control.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(control);
  expect(api.post).toHaveBeenCalledExactlyOnceWith(USER_PREFERENCES_ENDPOINTS.BASE, { transactionAlerts: false });
  api.get.mockResolvedValue({ data: { transactionAlerts: false } });
  await act(async () => save());
  await waitFor(() => {
    expect(control.disabled).toBe(false);
    expect(control.getAttribute('aria-checked')).toBe('false');
  });
});

it('reaches Profile from its settings row', async () => {
  show('settings');
  await screen.findByRole('switch');
  expect(screen.getByRole('link', { name: 'Profile' }).getAttribute('href')).toBe('/user-profile');
});

it('hides a stale preference after refresh failure', async () => {
  const client = show('settings');
  await screen.findByRole('switch');
  api.get.mockRejectedValueOnce(new Error('synthetic refresh failure'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: USER_PREFERENCES_QUERY_KEY });
  });
  expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
  expect(screen.queryByRole('switch')).toBeNull();
});

async function openPassword() {
  show('settings');
  await screen.findByRole('switch');
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Current password'), { target: { value: 'old-synthetic-password' } });
  fireEvent.change(within(dialog).getByLabelText('New password'), { target: { value: 'new-synthetic-password' } });
  fireEvent.change(within(dialog).getByLabelText('Confirm new password'), {
    target: { value: 'new-synthetic-password' },
  });
  return dialog;
}

it('keeps password failure visible and sends the unchanged contract on retry', async () => {
  api.post.mockRejectedValueOnce({ response: { data: { currentPassword: ['Incorrect'] } } });
  const dialog = await openPassword();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Current password is incorrect');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));
  expect(await screen.findByText('Your password was changed.')).toBeTruthy();
  expect(api.post).toHaveBeenLastCalledWith(AUTH_ENDPOINTS.CHANGE_PASSWORD, {
    currentPassword: 'old-synthetic-password',
    newPassword: 'new-synthetic-password',
    newPasswordConfirm: 'new-synthetic-password',
  });
});

it('refuses mismatched passwords without making a request', async () => {
  const dialog = await openPassword();
  fireEvent.change(within(dialog).getByLabelText('Confirm new password'), { target: { value: 'different-password' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Change password' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Passwords do not match');
  expect(api.post).not.toHaveBeenCalled();
});

it('requires the explicit deletion confirmation and clears private state only on success', async () => {
  api.post.mockRejectedValueOnce(new Error('synthetic refused deletion'));
  const client = show('settings');
  client.setQueryData(['private-record'], { secret: 'synthetic' });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  await screen.findByRole('switch');
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByText(/share register entries are kept/)).toBeTruthy();
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }));
  expect((await screen.findByRole('alert')).textContent).toContain('could not be deleted');
  expect(navigate).not.toHaveBeenCalled();
  expect(client.getQueryData(['private-record'])).toEqual({ secret: 'synthetic' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete account' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/signin'));
  expect(client.getQueryData(['private-record'])).toBeUndefined();
  expect(api.post).toHaveBeenLastCalledWith(USER_PROFILE_ENDPOINTS.DELETE_ACCOUNT);
});

it('reports export failure and retries a JSON download', async () => {
  const create = vi.fn<(blob: Blob) => string>(() => 'blob:synthetic-export');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  show('settings');
  await screen.findByRole('switch');
  fireEvent.click(screen.getByRole('button', { name: 'Export data' }));
  api.get.mockRejectedValueOnce(new Error('synthetic failed export'));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
  expect((await screen.findByRole('alert')).textContent).toContain('could not be exported');
  expect(create).not.toHaveBeenCalled();
  api.get.mockResolvedValueOnce({ data: { profile: { fullName: 'Avery Example' } } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Export' }));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  expect(api.get).toHaveBeenLastCalledWith(USER_PROFILE_ENDPOINTS.EXPORT_DATA, {});
  expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
});

it('saves self-reported name and address with phone details without changing verification fields', async () => {
  let currentProfile = { ...profile };
  const originalRead = api.get.getMockImplementation()!;
  api.get.mockImplementation((url: string, config?: unknown) =>
    url === USER_PROFILE_ENDPOINTS.BASE
      ? Promise.resolve({ data: { results: [currentProfile], next: null } })
      : originalRead(url, config),
  );
  api.patch.mockImplementationOnce(async (_url, body) => {
    currentProfile = { ...profile, ...body };
    return { data: currentProfile };
  });
  show('profile');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit personal details' }));
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Avery Updated' } });
  fireEvent.change(screen.getByLabelText('Residential address'), { target: { value: '12 Example Street\nSydney' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save personal details' }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
  expect(api.patch.mock.calls[0]![1]).toEqual({
    fullName: 'Avery Updated',
    residentialAddress: '12 Example Street\nSydney',
    phoneCountryCode: '+61',
    phoneNumber: '400000000',
  });
  expect(api.patch.mock.calls[0]![0]).toBe(USER_PROFILE_ENDPOINTS.DETAIL(profile.uuid));
  expect(await screen.findByText('Avery Updated')).toBeTruthy();
  expect(screen.getByText(/12 Example Street/)).toBeTruthy();
});

it.each(['logout', 'account'])('rejects a pending profile update and retires the editor after %s', async (change) => {
  const client = show('profile');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit personal details' }));
  let finish!: (value: unknown) => void;
  api.patch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save personal details' }));
  await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
  await act(async () => {
    if (change === 'logout') client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
    else
      client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
        data: { userProfile: 'profile-other', userAccount: { uuid: 'account-other', role: 'investor' } },
      });
    finish({ data: profile });
  });
  expect(screen.queryByLabelText('Residential address')).toBeNull();
  expect(screen.queryByText(profile.fullName)).toBeNull();
  expect(api.patch).toHaveBeenCalledTimes(1);
});

it('refuses a foreign profile response before offering personal details editing', async () => {
  api.get.mockResolvedValue({ data: { results: [{ ...profile, uuid: 'profile-other' }], next: null } });
  show('profile');
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText(profile.fullName)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit personal details' })).toBeNull();
  expect(api.patch).not.toHaveBeenCalled();
});

it('rejects a late profile read after the account changes without caching its personal fields', async () => {
  let finish!: (value: unknown) => void;
  api.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const client = show('profile');
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  await act(async () => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: 'profile-other', userAccount: { uuid: 'account-other', role: 'investor' } },
    });
    finish({ data: { results: [{ ...profile, fullName: 'Obsolete private name' }], next: null } });
  });
  expect(screen.queryByText('Obsolete private name')).toBeNull();
  expect(JSON.stringify(client.getQueriesData({ queryKey: ['userProfiles'] }))).not.toContain('Obsolete private name');
  expect(api.patch).not.toHaveBeenCalled();
});

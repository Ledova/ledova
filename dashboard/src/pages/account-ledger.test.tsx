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
vi.mock('@hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));
vi.mock('@hooks/useDocuments', () => ({ useDocumentsEnabled: () => false }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Review identity check' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close identity review' }));
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
});

it('keeps a failed phone edit and its values until a successful retry', async () => {
  api.patch.mockRejectedValueOnce(new Error('synthetic refused edit'));
  show('profile');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit phone' }));
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '411111111' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save phone' }));
  expect((await screen.findByRole('alert')).textContent).toContain('could not be saved');
  expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('411111111');
  fireEvent.click(screen.getByRole('button', { name: 'Save phone' }));
  await waitFor(() => expect(screen.queryByLabelText('Phone number')).toBeNull());
  expect(api.patch).toHaveBeenLastCalledWith(USER_PROFILE_ENDPOINTS.DETAIL(profile.uuid), {
    phoneCountryCode: '+61',
    phoneNumber: '411111111',
  });
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
  fireEvent.click(await screen.findByRole('button', { name: 'Edit phone' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save phone' }));
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
  expect(screen.queryByRole('button', { name: 'Edit phone' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Avery Example')).toBeTruthy();
});

it('distinguishes an empty profile from a failed read', async () => {
  api.get.mockResolvedValue({ data: { results: [], next: null } });
  show('profile');
  expect(await screen.findByText('No profile data is available.')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit phone' })).toBeNull();
});

it('preserves an unfinished phone edit across a failed background refresh', async () => {
  const client = show('profile');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit phone' }));
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '422222222' } });
  api.get.mockRejectedValueOnce(new Error('synthetic background failure'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['userProfiles'] });
  });
  expect((await screen.findByRole('alert')).textContent).toContain('could not be loaded');
  expect(screen.queryByRole('button', { name: 'Save phone' })).toBeNull();
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

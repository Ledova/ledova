import React from 'react';
import { Alert } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { ApiClientProvider, AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { clearTokens } from '../../services/tokenStorage';
import { invalidateSessionScope } from '../../services/sessionScope';
import { resetFiles } from '../../testSupport/documentFiles';
import { UserProfileScreen } from '../user-profile';
import { SettingsScreen } from '../settings';

const mockReset = jest.fn();
const mockLock = {
  biometricType: 'Touch ID',
  hasBiometricLogin: false,
  isEnabled: false,
  biometricsAvailable: true,
  enableBiometricLogin: jest.fn(),
  disableBiometricLogin: jest.fn(),
  setEnabled: jest.fn(),
};
jest.mock('../../contexts', () => ({ ...jest.requireActual('../../contexts'), useAppLock: () => mockLock }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useAuth: () => ({ isAuthenticated: true }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ reset: mockReset }) }));
jest.mock('../user-profile/components/VerificationModal', () => ({ VerificationModal: () => null }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), patch: jest.fn(), post: jest.fn() } }));
jest.mock('../../services/tokenStorage', () => ({ clearTokens: jest.fn() }));

const PROFILE = '/api/user-profiles/';
const PREFERENCES = '/api/user-preferences/';
const PASSWORD = '/api/change-password/';
const DELETE = '/api/user-profiles/delete-account/';
const EXPORT = '/api/user-profiles/export-data/';
const profile = {
  uuid: 'synthetic-member',
  fullName: 'Synthetic Member',
  email: 'member@example.test',
  phoneCountryCode: '+61',
  phoneNumber: '400000001',
  dateJoined: '2026-01-01T00:00:00Z',
  lastLogin: null,
};
let client: QueryClient;
let profileFailure: boolean;
let preferencesFailure: boolean;
let transactionAlerts: boolean;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  profileFailure = false;
  preferencesFailure = false;
  transactionAlerts = false;
  resetFiles();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
  jest.mocked(clearTokens).mockResolvedValue(undefined);
  mockLock.enableBiometricLogin.mockResolvedValue(true);
  mockLock.setEnabled.mockResolvedValue(true);
  jest.mocked(apiClient.get).mockImplementation(async (url) => {
    if (url === PROFILE) {
      if (profileFailure) throw new Error('Synthetic profile refusal');
      return { data: { results: [profile], count: 1, next: null, previous: null } };
    }
    if (url === PREFERENCES) {
      if (preferencesFailure) throw new Error('Synthetic preference refusal');
      return { data: { transactionAlerts } };
    }
    if (url === EXPORT) return { data: { profile: 'synthetic' } };
    throw new Error(`Unexpected GET ${url}`);
  });
  jest.mocked(apiClient.patch).mockResolvedValue({ data: profile });
  jest.mocked(apiClient.post).mockResolvedValue({ data: {} });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

async function screen(element: React.ReactElement) {
  if (element.type === UserProfileScreen)
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: profile.uuid, userAccount: { uuid: 'account-one', role: 'investor' } },
    });
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{element}</ApiClientProvider>
    </QueryClientProvider>,
  );
}

async function settingsScreen() {
  const view = await screen(<SettingsScreen />);
  await view.findByLabelText('Transaction alerts');
  return view;
}

async function editPhone() {
  const view = await screen(<UserProfileScreen />);
  await fireEvent.press(await view.findByText('Edit personal details'));
  await fireEvent.changeText(view.getByLabelText('Country code'), '+64');
  await fireEvent.changeText(view.getByLabelText('Phone number'), '200000002');
  return view;
}

async function passwordForm() {
  const view = await settingsScreen();
  await fireEvent.press(view.getByText('Change password'));
  await fireEvent.changeText(view.getByLabelText('Current password'), 'synthetic-current');
  await fireEvent.changeText(view.getByLabelText('New password'), 'synthetic-new');
  await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'synthetic-new');
  return view;
}

it('reads the profile without the old portfolio and notification requests', async () => {
  const view = await screen(<UserProfileScreen />);
  expect(await view.findByText('Synthetic Member')).toBeTruthy();
  expect(view.getByText('+61 400000001')).toBeTruthy();
  expect(apiClient.get).toHaveBeenCalledTimes(1);
  expect(apiClient.get).toHaveBeenCalledWith(
    PROFILE,
    expect.objectContaining({
      signal: expect.anything(),
      ledovaSubmissionGuard: expect.any(Function),
      ledovaSessionEpoch: expect.any(Number),
    }),
  );
});

it('reports an initial profile refusal and retries the current profile', async () => {
  profileFailure = true;
  const view = await screen(<UserProfileScreen />);
  expect(await view.findByText('Your profile could not be loaded.')).toBeTruthy();
  expect(view.queryByText('Edit personal details')).toBeNull();
  profileFailure = false;
  await fireEvent.press(view.getByText('Try again'));
  expect(await view.findByText('Synthetic Member')).toBeTruthy();
});

it('retains phone edits through a failed refresh and permits save only after recovery', async () => {
  const view = await editPhone();
  profileFailure = true;
  await act(() => view.getByTestId('profile-scroll').props.refreshControl.props.onRefresh());
  expect(await view.findByText('Your profile could not be loaded.')).toBeTruthy();
  expect(view.queryByText('Synthetic Member')).toBeNull();
  expect(view.getByLabelText('Phone number').props.value).toBe('200000002');
  await fireEvent.press(view.getByText('Save personal details'));
  expect(apiClient.patch).not.toHaveBeenCalled();
  profileFailure = false;
  await fireEvent.press(view.getByText('Try again'));
  await view.findByText('Synthetic Member');
  await waitFor(() => expect(view.getByRole('button', { name: 'Save personal details' })).toBeEnabled());
  await fireEvent.press(view.getByText('Save personal details'));
  await waitFor(() =>
    expect(apiClient.patch).toHaveBeenCalledWith(
      '/api/user-profiles/synthetic-member/',
      {
        fullName: profile.fullName,
        residentialAddress: '',
        phoneCountryCode: '+64',
        phoneNumber: '200000002',
      },
      expect.objectContaining({
        signal: expect.anything(),
        ledovaSubmissionGuard: expect.any(Function),
        ledovaSessionEpoch: expect.any(Number),
      }),
    ),
  );
  expect(await view.findByText('Edit personal details')).toBeTruthy();
});

it('retains a refused phone draft and guards cancellation and duplicate submission while saving', async () => {
  const view = await editPhone();
  const pending = deferred<{ data: typeof profile }>();
  jest.mocked(apiClient.patch).mockReturnValueOnce(pending.promise);
  await fireEvent.press(view.getByText('Save personal details'));
  await view.findByText('Saving…');
  await fireEvent.press(view.getByText('Cancel'));
  await fireEvent.press(view.getByText('Saving…'));
  expect(view.getByLabelText('Phone number').props.editable).toBe(false);
  expect(apiClient.patch).toHaveBeenCalledTimes(1);
  await act(() => pending.reject(new Error('Synthetic save refusal')));
  expect(await view.findByText('Your personal details could not be saved. Try again.')).toBeTruthy();
  expect(view.getByLabelText('Phone number').props.value).toBe('200000002');
  await fireEvent.press(view.getByText('Save personal details'));
  expect(await view.findByText('Edit personal details')).toBeTruthy();
  expect(apiClient.patch).toHaveBeenCalledTimes(2);
});

it('does not invent enabled notification preferences after a failed read', async () => {
  preferencesFailure = true;
  const view = await screen(<SettingsScreen />);
  expect(await view.findByText('Your notification settings could not be loaded.')).toBeTruthy();
  expect(view.queryByLabelText('Transaction alerts')).toBeNull();
  preferencesFailure = false;
  await fireEvent.press(view.getByText('Try notifications again'));
  expect((await view.findByLabelText('Transaction alerts')).props.value).toBe(false);
});

it('suppresses stale notification controls after a failed refresh', async () => {
  transactionAlerts = true;
  const view = await settingsScreen();
  expect(view.getByLabelText('Transaction alerts').props.value).toBe(true);
  preferencesFailure = true;
  await act(() => client.invalidateQueries({ queryKey: USER_PREFERENCES_QUERY_KEY }));
  expect(await view.findByText('Your notification settings could not be loaded.')).toBeTruthy();
  expect(view.queryByLabelText('Transaction alerts')).toBeNull();
});

it('reports a notification write refusal without changing its known saved value', async () => {
  const view = await settingsScreen();
  jest.mocked(apiClient.post).mockRejectedValueOnce(new Error('Synthetic write refusal'));
  await fireEvent(view.getByLabelText('Transaction alerts'), 'valueChange', true);
  expect(await view.findByText('Your notification setting could not be saved. Try again.')).toBeTruthy();
  expect(view.getByLabelText('Transaction alerts').props.value).toBe(false);
  expect(apiClient.post).toHaveBeenCalledWith(PREFERENCES, { transactionAlerts: true });
  transactionAlerts = true;
  await fireEvent(view.getByLabelText('Transaction alerts'), 'valueChange', true);
  await waitFor(() => expect(view.getByLabelText('Transaction alerts').props.value).toBe(true));
});

it('hints each settings switch with the sentence beside it', async () => {
  const view = await settingsScreen();
  expect(view.getByLabelText('Touch ID sign in').props.accessibilityHint).toBe(
    'Sign in with Touch ID instead of your password.',
  );
  expect(view.getByLabelText('App lock').props.accessibilityHint).toBe(
    'Require Touch ID after the app goes into the background.',
  );
  expect(view.getByLabelText('Transaction alerts').props.accessibilityHint).toBe(
    'Notifications for transaction status changes.',
  );
});

it('holds the alerts switch while its save is pending', async () => {
  const view = await settingsScreen();
  const saving = deferred<{ data: object }>();
  jest.mocked(apiClient.post).mockReturnValueOnce(saving.promise);
  try {
    await fireEvent(view.getByLabelText('Transaction alerts'), 'valueChange', true);
    await waitFor(() => expect(view.getByLabelText('Transaction alerts').props.disabled).toBe(true));
    expect(view.getByLabelText('Transaction alerts').props.value).toBe(false);
  } finally {
    transactionAlerts = true;
    await act(() => saving.resolve({ data: {} }));
  }
  await waitFor(() => {
    expect(view.getByLabelText('Transaction alerts').props.disabled).toBe(false);
    expect(view.getByLabelText('Transaction alerts').props.value).toBe(true);
  });
  expect(apiClient.post).toHaveBeenCalledTimes(1);
});

it.each([
  ['Touch ID sign in', mockLock.enableBiometricLogin],
  ['App lock', mockLock.setEnabled],
] as const)('holds both security switches while %s is saving', async (label, save) => {
  const saving = deferred<boolean>();
  save.mockReturnValueOnce(saving.promise);
  const view = await settingsScreen();
  try {
    await fireEvent(view.getByLabelText(label), 'valueChange', true);
    await waitFor(() => expect(view.getByLabelText('Touch ID sign in').props.disabled).toBe(true));
    expect(view.getByLabelText('App lock').props.disabled).toBe(true);
  } finally {
    await act(() => saving.resolve(true));
  }
  await waitFor(() => expect(view.getByLabelText('Touch ID sign in').props.disabled).toBe(false));
  expect(view.getByLabelText('App lock').props.disabled).toBe(false);
  expect(save).toHaveBeenCalledTimes(1);
});

it('validates password confirmation before writing and retains all fields on refusal', async () => {
  const view = await passwordForm();
  await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'different');
  await fireEvent.press(view.getByText('Save password'));
  expect(view.getByText('The new passwords do not match.')).toBeTruthy();
  expect(apiClient.post).not.toHaveBeenCalled();
  await fireEvent.changeText(view.getByLabelText('Confirm new password'), 'synthetic-new');
  jest.mocked(apiClient.post).mockRejectedValueOnce(new Error('Synthetic password refusal'));
  await fireEvent.press(view.getByText('Save password'));
  expect(await view.findByText('Your password could not be changed. Check the details and try again.')).toBeTruthy();
  expect(view.getByLabelText('Current password').props.value).toBe('synthetic-current');
  expect(view.getByLabelText('New password').props.value).toBe('synthetic-new');
  expect(view.getByLabelText('Confirm new password').props.value).toBe('synthetic-new');
  expect(apiClient.post).toHaveBeenCalledWith(PASSWORD, {
    currentPassword: 'synthetic-current',
    newPassword: 'synthetic-new',
    newPasswordConfirm: 'synthetic-new',
  });
});

it('blocks password duplicate submission and all dismissals until the request settles', async () => {
  const view = await passwordForm();
  const pending = deferred<{ data: object }>();
  jest.mocked(apiClient.post).mockReturnValueOnce(pending.promise);
  await fireEvent.press(view.getByText('Save password'));
  await view.findByText('Saving…');
  await fireEvent.press(view.getByText('Cancel'));
  await fireEvent.press(view.getByTestId('modal-backdrop-Change password', { includeHiddenElements: true }));
  const modal = view.getByTestId('modal-Change password');
  await fireEvent(modal, 'requestClose');
  await fireEvent.press(view.getByText('Saving…'));
  expect(view.getByLabelText('Current password').props.editable).toBe(false);
  expect(apiClient.post).toHaveBeenCalledTimes(1);
  await act(() => pending.resolve({ data: {} }));
  await waitFor(() => expect(view.queryByLabelText('Current password')).toBeNull());
  await fireEvent.press(view.getByText('Change password'));
  expect(view.getByLabelText('Current password').props.value).toBe('');
});

it('keeps the export confirmation open after failure and retries into a private file', async () => {
  const view = await settingsScreen();
  await fireEvent.press(view.getByText('Export data'));
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
  await fireEvent.press(view.getByText('Export'));
  expect(await view.findByText('Your data could not be exported. Try again.')).toBeTruthy();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('Export'));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(view.queryByText('Export')).toBeNull());
});

it('requires explicit deletion and retains the session and confirmation on refusal', async () => {
  const view = await settingsScreen();
  client.setQueryData(['private-account'], { synthetic: true });
  await fireEvent.press(view.getByText('Delete account'));
  expect(view.getByText('This action cannot be undone.')).toBeTruthy();
  expect(view.getByText(/country of citizenship, financial profile, wallets/)).toBeTruthy();
  expect(apiClient.post).not.toHaveBeenCalled();
  jest.mocked(apiClient.post).mockRejectedValueOnce(new Error('Synthetic deletion refusal'));
  await fireEvent.press(view.getByText('Confirm deletion'));
  expect(
    await view.findByText('Your account could not be deleted. Try again or contact the deployment operator.'),
  ).toBeTruthy();
  expect(clearTokens).not.toHaveBeenCalled();
  expect(mockReset).not.toHaveBeenCalled();
  expect(client.getQueryData(['private-account'])).toEqual({ synthetic: true });
  expect(apiClient.post).toHaveBeenLastCalledWith(DELETE);
  await fireEvent.press(view.getByText('Cancel'));
  expect(view.queryByText('Confirm deletion')).toBeNull();
});

it('reports a refused biometric action and allows another attempt', async () => {
  const view = await settingsScreen();
  mockLock.enableBiometricLogin.mockResolvedValueOnce(false);
  await fireEvent(view.getByLabelText('Touch ID sign in'), 'valueChange', true);
  expect(await view.findByText('Authentication could not be completed. Try again.')).toBeTruthy();
  await fireEvent(view.getByLabelText('Touch ID sign in'), 'valueChange', true);
  await waitFor(() => expect(view.queryByText('Authentication could not be completed. Try again.')).toBeNull());
  expect(mockLock.enableBiometricLogin).toHaveBeenCalledTimes(2);
});

it('saves self-reported profile name and address alongside phone without verification fields', async () => {
  let currentProfile = { ...profile };
  const originalRead = jest.mocked(apiClient.get).getMockImplementation()!;
  jest
    .mocked(apiClient.get)
    .mockImplementation((url, config) =>
      url === PROFILE
        ? Promise.resolve({ data: { results: [currentProfile], count: 1, next: null, previous: null } })
        : originalRead(url, config),
    );
  jest.mocked(apiClient.patch).mockImplementationOnce(async (_url, body) => {
    currentProfile = { ...profile, ...(body as Record<string, unknown>) };
    return { data: currentProfile };
  });
  const view = await editPhone();
  await fireEvent.changeText(view.getByLabelText('Full name'), 'Synthetic Updated');
  await fireEvent.changeText(view.getByLabelText('Residential address'), '24 Example Road\nSydney');
  await fireEvent.press(view.getByText('Save personal details'));
  await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1));
  expect(jest.mocked(apiClient.patch).mock.calls[0]![1]).toEqual({
    fullName: 'Synthetic Updated',
    residentialAddress: '24 Example Road\nSydney',
    phoneCountryCode: '+64',
    phoneNumber: '200000002',
  });
  expect(jest.mocked(apiClient.patch).mock.calls[0]![0]).toBe(PROFILE + profile.uuid + '/');
  expect(await view.findByText('Synthetic Updated')).toBeTruthy();
  expect(view.getByText('24 Example Road\nSydney')).toBeTruthy();
});

it.each(['logout', 'account', 'epoch'])(
  'rejects a pending profile save and retires its personal editor after %s',
  async (change) => {
    const view = await editPhone();
    const pending = deferred<{ data: typeof profile }>();
    jest.mocked(apiClient.patch).mockReturnValueOnce(pending.promise);
    await fireEvent.press(view.getByText('Save personal details'));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledTimes(1));
    await act(async () => {
      if (change === 'logout') client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
      else if (change === 'account')
        client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
          data: { userProfile: 'profile-other', userAccount: { uuid: 'account-other', role: 'investor' } },
        });
      else invalidateSessionScope();
      pending.resolve({ data: profile });
    });
    expect(view.queryByLabelText('Residential address')).toBeNull();
    expect(apiClient.patch).toHaveBeenCalledTimes(1);
  },
);

it('rejects a foreign profile response without exposing its personal details', async () => {
  jest
    .mocked(apiClient.get)
    .mockResolvedValue({ data: { results: [{ ...profile, uuid: 'profile-other' }], next: null } });
  const view = await screen(<UserProfileScreen />);
  expect(await view.findByText('Your profile could not be loaded.')).toBeTruthy();
  expect(view.queryByText(profile.fullName)).toBeNull();
  expect(view.queryByText('Edit personal details')).toBeNull();
  expect(apiClient.patch).not.toHaveBeenCalled();
});

it('rejects a late profile read after a same-account epoch change without caching its personal fields', async () => {
  const pending = deferred<{ data: { results: Array<typeof profile>; next: null } }>();
  jest.mocked(apiClient.get).mockReturnValueOnce(pending.promise);
  const view = await screen(<UserProfileScreen />);
  await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(1));
  await act(async () => {
    invalidateSessionScope();
    pending.resolve({ data: { results: [{ ...profile, fullName: 'Obsolete private name' }], next: null } });
  });
  expect(view.queryByText('Obsolete private name')).toBeNull();
  expect(JSON.stringify(client.getQueriesData({ queryKey: ['userProfiles'] }))).not.toContain('Obsolete private name');
  expect(apiClient.patch).not.toHaveBeenCalled();
});

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { COUNTRIES, getUserProfiles } from '@ledova/shared';
import { useUserProfile } from './useUserProfile';

jest.mock('@ledova/shared', () => ({ ...jest.requireActual('@ledova/shared'), getUserProfiles: jest.fn() }));
jest.mock('../../../services/apiClient', () => ({ apiClient: {} }));

const profile = {
  uuid: 'profile-1',
  fullName: 'Synthetic Person',
  dateOfBirth: '1990-01-01',
  residentialAddress: '1 Synthetic Street, Sydney',
  phoneCountryCode: '+44',
  phoneNumber: '7700900123',
};

const loadProfiles = jest.mocked(getUserProfiles);

beforeEach(() => {
  jest.clearAllMocks();
});

it('loads the saved profile once and keeps edits and the chosen country after a country change', async () => {
  loadProfiles.mockResolvedValue({ data: { count: 1, results: [profile] } } as never);
  const { result } = await renderHook(() => useUserProfile());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.selectedCountry.code).toBe('GB');
  expect(result.current.form.fullName).toBe('Synthetic Person');

  await act(async () => result.current.setFieldValue('fullName', 'Edited Person'));
  await act(async () => result.current.handleCountryChange(COUNTRIES.find((country) => country.code === 'AU')!));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(loadProfiles).toHaveBeenCalledTimes(1);
  expect(result.current.isLoading).toBe(false);
  expect(result.current.form.fullName).toBe('Edited Person');
  expect(result.current.form.phoneCountryCode).toBe('+61');
  expect(result.current.selectedCountry.code).toBe('AU');
});

it('retries a failed load from a fresh loading state', async () => {
  loadProfiles
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ data: { count: 1, results: [profile] } } as never);
  const { result } = await renderHook(() => useUserProfile());
  await waitFor(() => expect(result.current.generalError).toBe('Failed to load profile data. Please try again.'));
  expect(result.current.isLoading).toBe(false);

  await act(async () => result.current.retryLoad());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.generalError).toBe('');
  expect(result.current.form.fullName).toBe('Synthetic Person');
  expect(loadProfiles).toHaveBeenCalledTimes(2);
});

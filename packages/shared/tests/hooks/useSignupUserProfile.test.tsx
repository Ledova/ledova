/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { COUNTRIES } from '../../src/constants/countries';
import { useSignupUserProfile } from '../../src/hooks/useSignupUserProfile';
import { providers, signupApi } from '../fixtures/signup';

const api = signupApi();
const wrapper = providers(api);

const profile = {
  uuid: 'profile-1',
  fullName: 'Synthetic Person',
  dateOfBirth: '1990-01-01',
  residentialAddress: '1 Synthetic Street, Sydney',
  phoneCountryCode: '+44',
  phoneNumber: '7700900123',
};
const PROXY_PAGE =
  '<!DOCTYPE html><html><head><title>403 Forbidden</title></head><body><h1>403 Forbidden</h1></body></html>';

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function filledIn(results: object[] = [profile]) {
  api.get.mockResolvedValue({ data: { count: results.length, results } });
  const view = renderHook(() => useSignupUserProfile(), { wrapper });
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  act(() => {
    view.result.current.setFieldValue('fullName', profile.fullName);
    view.result.current.setFieldValue('dateOfBirth', profile.dateOfBirth);
    view.result.current.setFieldValue('residentialAddress', profile.residentialAddress);
    view.result.current.setFieldValue('phoneNumber', profile.phoneNumber);
  });
  return view;
}

it('says the profile is missing, and sends nothing, when there is no profile to update', async () => {
  const { result } = await filledIn([]);
  const moveOn = jest.fn();

  await act(() => result.current.handleSubmit(moveOn));

  expect(result.current.generalError).toBe('User profile not found. Please contact support.');
  expect(result.current.errors).toEqual({});
  expect(api.patch).not.toHaveBeenCalled();
  expect(moveOn).not.toHaveBeenCalled();
});

it.each<[string, number, unknown, string, Record<string, string[]>]>([
  ['a sentence', 409, 'Profile changes are paused.', 'Profile changes are paused.', {}],
  [
    'refusals for a field the form shows and one it does not',
    400,
    { phoneNumber: ['Enter a valid phone number.'], phoneCountryCode: ['Choose a supported country.'] },
    'Choose a supported country.',
    { phoneNumber: ['Enter a valid phone number.'] },
  ],
  ['a proxy error page', 403, PROXY_PAGE, 'Failed to save profile. Please try again.', {}],
  ['an empty answer', 404, '', 'Failed to save profile. Please try again.', {}],
])('shows what a person can read when the server answers with %s', async (_, status, data, shown, marked) => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.patch.mockRejectedValue({ response: { status, data } });
  const { result } = await filledIn();

  await act(() => result.current.handleSubmit(jest.fn()));

  expect(result.current.generalError).toBe(shown);
  expect(result.current.errors).toEqual(marked);
});

it('still says to check the connection when no answer came back', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.patch.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
  const { result } = await filledIn();

  await act(() => result.current.handleSubmit(jest.fn()));

  expect(result.current.generalError).toBe('Network error. Please check your connection.');
  expect(result.current.errors).toEqual({});
});

it('loads the saved profile once and keeps edits and the chosen country after a country change', async () => {
  api.get.mockResolvedValue({ data: { count: 1, results: [profile] } });
  const { result } = renderHook(() => useSignupUserProfile(), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.selectedCountry.code).toBe('GB');
  expect(result.current.form.fullName).toBe('Synthetic Person');

  act(() => result.current.setFieldValue('fullName', 'Edited Person'));
  act(() => result.current.handleCountryChange(COUNTRIES.find((country) => country.code === 'AU')!));
  await settle();

  expect(api.get).toHaveBeenCalledTimes(1);
  expect(result.current.isLoading).toBe(false);
  expect(result.current.form.fullName).toBe('Edited Person');
  expect(result.current.form.phoneCountryCode).toBe('+61');
  expect(result.current.selectedCountry.code).toBe('AU');
});

it('retries a failed load from a fresh loading state', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { count: 1, results: [profile] } });
  const { result } = renderHook(() => useSignupUserProfile(), { wrapper });
  await waitFor(() => expect(result.current.generalError).toBe('Failed to load profile data. Please try again.'));
  expect(result.current.isLoading).toBe(false);
  expect(console.error).toHaveBeenCalledWith('Failed to load profile data: Error: offline');

  act(() => result.current.retryLoad());
  expect(result.current.isLoading).toBe(true);
  expect(result.current.generalError).toBe('');
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.generalError).toBe('');
  expect(result.current.form.fullName).toBe('Synthetic Person');
  expect(api.get).toHaveBeenCalledTimes(2);
});

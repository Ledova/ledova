/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { useSignupPreScreening } from '../../src/hooks/useSignupPreScreening';
import { providers, signupApi } from '../fixtures/signup';

const api = signupApi();
const wrapper = providers(api);

const profile = {
  uuid: 'profile-1',
  confirmedOver18: true,
  confirmedAustralianResident: true,
  confirmedIndividualAccount: false,
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

async function confirmedEverything(results: object[] = [profile]) {
  api.get.mockResolvedValue({ data: { count: results.length, results } });
  const view = renderHook(() => useSignupPreScreening(), { wrapper });
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  act(() => {
    view.result.current.setFieldValue('confirmedOver18', true);
    view.result.current.setFieldValue('confirmedAustralianResident', true);
    view.result.current.setFieldValue('confirmedIndividualAccount', true);
    view.result.current.toggleWholesaleOnly();
  });
  return view;
}

it('says the profile is missing, and sends nothing, when there is no profile to update', async () => {
  const { result } = await confirmedEverything([]);
  const moveOn = jest.fn();

  await act(() => result.current.handleSubmit(moveOn));

  expect(result.current.generalError).toBe('User profile not found. Please contact support.');
  expect(api.patch).not.toHaveBeenCalled();
  expect(moveOn).not.toHaveBeenCalled();
});

it.each<[string, number, unknown, string]>([
  ['a sentence', 409, 'Pre-screening is closed for this account.', 'Pre-screening is closed for this account.'],
  [
    'a refusal for a declaration',
    400,
    { confirmedOver18: ['You must be 18 or older to continue.'] },
    'You must be 18 or older to continue.',
  ],
  ['a proxy error page', 403, PROXY_PAGE, 'Failed to save pre-screening. Please try again.'],
  ['an empty answer', 404, '', 'Failed to save pre-screening. Please try again.'],
])('shows what a person can read when the server answers with %s', async (_, status, data, shown) => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.patch.mockRejectedValue({ response: { status, data } });
  const { result } = await confirmedEverything();

  await act(() => result.current.handleSubmit(jest.fn()));

  expect(result.current.generalError).toBe(shown);
});

it('still says to check the connection when no answer came back', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.patch.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
  const { result } = await confirmedEverything();

  await act(() => result.current.handleSubmit(jest.fn()));

  expect(result.current.generalError).toBe('Network error. Please check your connection.');
});

it('loads the saved confirmations on mount', async () => {
  api.get.mockResolvedValue({ data: { count: 1, results: [profile] } });
  const { result } = renderHook(() => useSignupPreScreening(), { wrapper });
  expect(result.current.isLoading).toBe(true);
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.existingProfileUuid).toBe('profile-1');
  expect(result.current.form).toEqual({
    confirmedOver18: true,
    confirmedAustralianResident: true,
    confirmedIndividualAccount: false,
  });
  expect(api.get).toHaveBeenCalledTimes(1);
});

it('retries a failed load from a fresh loading state', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { count: 1, results: [profile] } });
  const { result } = renderHook(() => useSignupPreScreening(), { wrapper });
  await waitFor(() => expect(result.current.generalError).toBe('Failed to load profile data. Please try again.'));
  expect(result.current.isLoading).toBe(false);
  expect(console.error).toHaveBeenCalledWith('Failed to load profile data: Error: offline');

  act(() => result.current.retryLoad());
  expect(result.current.isLoading).toBe(true);
  expect(result.current.generalError).toBe('');
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.existingProfileUuid).toBe('profile-1');
  expect(api.get).toHaveBeenCalledTimes(2);
});

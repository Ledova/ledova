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

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
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

// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSignupPreScreening } from './useSignupPreScreening';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

const profile = {
  uuid: 'profile-1',
  confirmedOver18: true,
  confirmedAustralianResident: true,
  confirmedIndividualAccount: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('loads the saved confirmations on mount', async () => {
  api.get.mockResolvedValue({ data: { count: 1, results: [profile] } });
  const { result } = renderHook(() => useSignupPreScreening());
  expect(result.current.isLoading).toBe(true);
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.existingProfileUuid).toBe('profile-1');
  expect(result.current.form).toEqual({
    confirmedOver18: true,
    confirmedAustralianResident: true,
    confirmedIndividualAccount: false,
  });
  expect(api.get).toHaveBeenCalledOnce();
});

it('retries a failed load from a fresh loading state', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  api.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { count: 1, results: [profile] } });
  const { result } = renderHook(() => useSignupPreScreening());
  await waitFor(() => expect(result.current.generalError).toBe('Failed to load profile data. Please try again.'));
  expect(result.current.isLoading).toBe(false);

  act(() => result.current.retryLoad());
  expect(result.current.isLoading).toBe(true);
  expect(result.current.generalError).toBe('');
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.existingProfileUuid).toBe('profile-1');
  expect(api.get).toHaveBeenCalledTimes(2);
});

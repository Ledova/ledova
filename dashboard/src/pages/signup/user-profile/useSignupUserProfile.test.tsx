// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { COUNTRIES } from '@ledova/shared';
import { useSignupUserProfile } from './useSignupUserProfile';

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

const profile = {
  uuid: 'profile-1',
  fullName: 'Synthetic Person',
  dateOfBirth: '1990-01-01',
  residentialAddress: '1 Synthetic Street, Sydney',
  phoneCountryCode: '+44',
  phoneNumber: '7700900123',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it('loads the saved profile once and keeps edits and the chosen country after a country change', async () => {
  api.get.mockResolvedValue({ data: { count: 1, results: [profile] } });
  const { result } = renderHook(() => useSignupUserProfile());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.selectedCountry.code).toBe('GB');
  expect(result.current.form.fullName).toBe('Synthetic Person');

  act(() => result.current.setFieldValue('fullName', 'Edited Person'));
  act(() => result.current.handleCountryChange(COUNTRIES.find((country) => country.code === 'AU')!));
  await settle();

  expect(api.get).toHaveBeenCalledOnce();
  expect(result.current.isLoading).toBe(false);
  expect(result.current.form.fullName).toBe('Edited Person');
  expect(result.current.form.phoneCountryCode).toBe('+61');
  expect(result.current.selectedCountry.code).toBe('AU');
});

it('retries a failed load from a fresh loading state', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  api.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { count: 1, results: [profile] } });
  const { result } = renderHook(() => useSignupUserProfile());
  await waitFor(() => expect(result.current.generalError).toBe('Failed to load profile data. Please try again.'));
  expect(result.current.isLoading).toBe(false);

  act(() => result.current.retryLoad());
  expect(result.current.isLoading).toBe(true);
  expect(result.current.generalError).toBe('');
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.form.fullName).toBe('Synthetic Person');
  expect(api.get).toHaveBeenCalledTimes(2);
});

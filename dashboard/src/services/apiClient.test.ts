// @vitest-environment jsdom

import { AUTH_ENDPOINTS, AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { AxiosError, CanceledError } from 'axios';
import { afterEach, expect, it, vi } from 'vitest';
import apiClient from './apiClient';
import { queryClient } from './queryClient';

afterEach(() => {
  vi.restoreAllMocks();
  queryClient.clear();
});

it('keeps cancelled reads quiet, reports request failures and holds writes while the session is rechecked', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const cancelled = new CanceledError('Request abandoned');
  const adapter = vi.fn().mockRejectedValue(cancelled);
  await expect(apiClient.get('/synthetic', { adapter })).rejects.toBe(cancelled);
  expect(adapter).toHaveBeenCalledOnce();
  expect(log).not.toHaveBeenCalled();

  adapter.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'));
  await expect(apiClient.get('/synthetic', { adapter })).rejects.toMatchObject({
    message: 'Unable to connect to our servers. Please check your internet connection and try again.',
  });
  expect(log).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledWith(expect.stringContaining('API request failed: code=ERR_NETWORK'));

  const sent = vi.fn().mockResolvedValue({ data: {}, status: 200, statusText: 'OK', headers: {}, config: {} });
  queryClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  queryClient.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: { userProfile: 'profile-one' } });
  await apiClient.post('/synthetic', {}, { adapter: sent });
  expect(sent).toHaveBeenCalledOnce();
  void queryClient.prefetchQuery({ queryKey: USER_PREFERENCES_QUERY_KEY, queryFn: () => new Promise(() => {}) });
  await expect(apiClient.post('/synthetic', {}, { adapter: sent })).rejects.toMatchObject({
    message: 'Your session is being checked. Try again in a moment.',
  });
  expect(sent).toHaveBeenCalledOnce();
  await apiClient.get('/synthetic', { adapter: sent });
  await apiClient.post(AUTH_ENDPOINTS.SIGNOUT, {}, { adapter: sent });
  expect(sent).toHaveBeenCalledTimes(3);
});

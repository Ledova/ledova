// @vitest-environment jsdom

import { AxiosError, CanceledError } from 'axios';
import { afterEach, expect, it, vi } from 'vitest';
import apiClient from './apiClient';

afterEach(() => vi.restoreAllMocks());

it('keeps cancelled reads quiet and still reports request failures', async () => {
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
});

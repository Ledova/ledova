/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios from 'axios';
import type { PropsWithChildren } from 'react';

import { IDENTITY_VERIFICATION_ENDPOINTS } from '../../src/constants/api';
import { ApiClientProvider } from '../../src/hooks/useApiClient';
import { useIdentityVerificationStatus } from '../../src/hooks/useIdentityVerificationStatus';

let client: QueryClient;
let get: jest.SpyInstance;

const PENDING = { isVerified: false, needsRetry: false, reviewAnswer: null, status: 'pending' };

function harness() {
  client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
  const apiClient = axios.create();
  get = jest.spyOn(apiClient, 'get').mockResolvedValue({ data: PENDING });
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

async function elapse(milliseconds: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(milliseconds);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  client.clear();
  jest.useRealTimers();
  jest.restoreAllMocks();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

it('reads the status through the provided client', async () => {
  const wrapper = harness();
  const { result } = renderHook(() => useIdentityVerificationStatus(false), { wrapper });

  await waitFor(() => expect(result.current.data).toEqual(PENDING));
  expect(get).toHaveBeenCalledWith(IDENTITY_VERIFICATION_ENDPOINTS.STATUS);
});

it('does not poll before a submission', async () => {
  const wrapper = harness();
  renderHook(() => useIdentityVerificationStatus(false), { wrapper });
  await elapse(0);

  await elapse(15000);
  expect(get).toHaveBeenCalledTimes(1);
});

it.each([
  ['verified', { ...PENDING, isVerified: true, status: 'completed' }],
  ['finally refused', { ...PENDING, reviewAnswer: 'RED', status: 'completed' }],
])('polls every five seconds after a submission and stops once the check is %s', async (_, outcome) => {
  const wrapper = harness();
  renderHook(() => useIdentityVerificationStatus(true), { wrapper });
  await elapse(0);
  expect(get).toHaveBeenCalledTimes(1);

  await elapse(4999);
  expect(get).toHaveBeenCalledTimes(1);
  await elapse(1);
  expect(get).toHaveBeenCalledTimes(2);

  get.mockResolvedValue({ data: outcome });
  await elapse(5000);
  expect(get).toHaveBeenCalledTimes(3);
  await elapse(15000);
  expect(get).toHaveBeenCalledTimes(3);
});

it('keeps polling a refusal that allows a retry', async () => {
  const wrapper = harness();
  get.mockResolvedValue({ data: { ...PENDING, reviewAnswer: 'RED', needsRetry: true, status: 'completed' } });
  renderHook(() => useIdentityVerificationStatus(true), { wrapper });
  await elapse(0);

  await elapse(10000);
  expect(get).toHaveBeenCalledTimes(3);
});

it('retries a failed read once', async () => {
  const wrapper = harness();
  get.mockRejectedValue(new Error('Synthetic failure'));
  const { result } = renderHook(() => useIdentityVerificationStatus(false), { wrapper });

  await elapse(5000);
  expect(result.current.isError).toBe(true);
  expect(get).toHaveBeenCalledTimes(2);
});

it('reads again on reconnect but not on focus', async () => {
  const wrapper = harness();
  renderHook(() => useIdentityVerificationStatus(false), { wrapper });
  await elapse(0);
  await elapse(60 * 60 * 1000);

  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await elapse(0);
  expect(get).toHaveBeenCalledTimes(1);

  await act(async () => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await elapse(0);
  expect(get).toHaveBeenCalledTimes(2);
});

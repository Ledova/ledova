// @vitest-environment jsdom

import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiClientProvider } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { useIdentityVerification } from './useIdentityVerification';

vi.mock('@services/apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@sumsub/websdk', () => ({ default: { init: vi.fn() } }));

const FORM_URL = 'https://verification.example.test/form';
let client: QueryClient;

function wrapper({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

function completeForm() {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { event: 'FORM_COMPLETED' } }));
  });
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.mocked(apiClient.get).mockResolvedValue({ data: { isVerified: false, status: 'init' } });
  vi.mocked(apiClient.post).mockResolvedValue({ data: { formUrl: FORM_URL } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.resetAllMocks();
});

it('refreshes the verification status and the profile when a launch is issued', async () => {
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => useIdentityVerification(), { wrapper });
  await act(async () => {
    await result.current.launchVerification('#container');
  });
  expect(result.current.formUrl).toBe(FORM_URL);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['identity-verification', 'status'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['userProfiles'] });
});

it('refreshes the profile once a submitted verification has been reviewed', async () => {
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const { result } = renderHook(() => useIdentityVerification(), { wrapper });
  await act(async () => {
    await result.current.launchVerification('#container');
  });
  invalidate.mockClear();
  completeForm();
  expect(result.current.justSubmitted).toBe(true);
  expect(result.current.formUrl).toBeNull();
  expect(invalidate).not.toHaveBeenCalled();
  vi.mocked(apiClient.get).mockResolvedValue({ data: { isVerified: true, status: 'completed' } });
  await act(async () => {
    await result.current.refetchStatus();
  });
  await waitFor(() => expect(result.current.justSubmitted).toBe(false));
  expect(result.current.isVerified).toBe(true);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['userProfiles'] });
});

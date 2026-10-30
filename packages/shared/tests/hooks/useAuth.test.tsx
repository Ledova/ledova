/** @jest-environment jsdom */
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import type { PropsWithChildren } from 'react';

import { ApiClientProvider } from '../../src/hooks/useApiClient';
import { useAuth } from '../../src/hooks/useAuth';

const clients: QueryClient[] = [];

function harness(focus = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: focus } } });
  const apiClient = axios.create();
  const get = jest.spyOn(apiClient, 'get').mockResolvedValue({ data: { valid: true } });
  clients.push(client);
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  return { client, get, wrapper };
}

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

describe('shared authentication follows the client refetch policy', () => {
  it('retries a failed check once, reports it unavailable rather than signed out, and recovers on a later mount', async () => {
    const { get, wrapper } = harness();
    get.mockRejectedValueOnce(new Error('Network unavailable')).mockRejectedValueOnce(new Error('Network unavailable'));
    const first = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(first.result.current.isUnavailable).toBe(true), { timeout: 3000 });
    expect(first.result.current.isAuthenticated).toBe(false);
    expect(get).toHaveBeenCalledTimes(2);
    first.unmount();

    const second = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(second.result.current.isAuthenticated).toBe(true));
    expect(second.result.current.isUnavailable).toBe(false);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('shares one session check between consumers of the same client', async () => {
    const { get, wrapper } = harness();
    const { result } = renderHook(() => [useAuth(), useAuth()], { wrapper });

    await waitFor(() => expect(result.current.every((auth) => auth.isAuthenticated)).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('reports an invalid answer, or a 401 after the token refresh failed, as signed out without retrying', async () => {
    const { get, wrapper } = harness();
    get.mockResolvedValue({ data: { valid: false } });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isUnavailable).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);

    const expired = harness();
    expired.get.mockRejectedValue(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }));
    const after = renderHook(() => useAuth(), { wrapper: expired.wrapper });

    await waitFor(() => expect(after.result.current.isFetching).toBe(false));
    expect(after.result.current.isAuthenticated).toBe(false);
    expect(after.result.current.isUnavailable).toBe(false);
    expect(expired.get).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom

import type { PropsWithChildren } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { USER_ACCOUNT_ENDPOINTS } from '@ledova/shared';
import { useRole } from './useRole';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('./useAuth', () => ({ useAuth: () => ({ isAuthenticated: true }) }));

let client: QueryClient;

function renderRole() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useRole(), { wrapper });
}

afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
});

it('knows the role once the account is read', async () => {
  api.get.mockResolvedValue({ data: { role: 'company' } });
  const { result } = renderRole();

  await waitFor(() => expect(result.current.isKnown).toBe(true));

  expect(result.current).toMatchObject({ role: 'company', isCompany: true, isInvestor: false, isUnavailable: false });
  expect(api.get).toHaveBeenCalledWith(USER_ACCOUNT_ENDPOINTS.BASE);
});

it('says the role is unavailable when the account cannot be read, rather than letting its fallback pass as known', async () => {
  api.get.mockRejectedValue(new Error('Network unavailable'));
  const { result } = renderRole();

  await waitFor(() => expect(result.current.isUnavailable).toBe(true));

  expect(result.current.isKnown).toBe(false);
});

it('reads the account again on retry and then knows the role', async () => {
  api.get.mockRejectedValueOnce(new Error('Network unavailable'));
  const { result } = renderRole();
  await waitFor(() => expect(result.current.isUnavailable).toBe(true));

  api.get.mockResolvedValue({ data: { role: 'investor' } });
  await act(async () => {
    await result.current.retry();
  });

  await waitFor(() => expect(result.current.isKnown).toBe(true));
  expect(result.current).toMatchObject({ role: 'investor', isUnavailable: false });
  expect(api.get).toHaveBeenCalledTimes(2);
});

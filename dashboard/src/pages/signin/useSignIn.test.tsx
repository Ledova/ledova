// @vitest-environment jsdom

import { AUTH_QUERY_KEY, signin } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSignIn } from './useSignIn';

vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  signin: vi.fn(),
  verifyAuth: vi.fn(),
}));

const signinMock = vi.mocked(signin);

const createHarness = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
};

const fillForm = (result: ReturnType<typeof renderHook<ReturnType<typeof useSignIn>, unknown>>['result']) => {
  act(() => result.current.setFieldValue('email', 'founder@example.test'));
  act(() => result.current.setFieldValue('password', 'correct horse battery staple'));
};

describe('useSignIn', () => {
  beforeEach(() => {
    signinMock.mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('signs in, refreshes authentication state, then reports success', async () => {
    const { queryClient, wrapper } = createHarness();
    const callOrder: string[] = [];
    const storageWrite = vi.spyOn(Storage.prototype, 'setItem');
    signinMock.mockImplementation(async () => {
      callOrder.push('signin');
      return {
        data: { access: 'legacy-access-token', refresh: 'legacy-refresh-token', token: 'legacy-token' },
      } as never;
    });
    vi.spyOn(queryClient, 'refetchQueries').mockImplementation(async (filters) => {
      expect(filters).toEqual({ queryKey: AUTH_QUERY_KEY, exact: true });
      callOrder.push('refetch');
    });
    const onSuccess = vi.fn(() => callOrder.push('success'));
    const { result, unmount } = renderHook(() => useSignIn(), { wrapper });
    fillForm(result);

    await act(async () => {
      await result.current.handleSubmit(onSuccess);
    });

    expect(signinMock).toHaveBeenCalledWith(apiClient, {
      email: 'founder@example.test',
      password: 'correct horse battery staple',
    });
    expect(callOrder).toEqual(['signin', 'refetch', 'success']);
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(storageWrite).not.toHaveBeenCalled();
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);

    unmount();
    queryClient.clear();
  });

  it('forgets what the tab held for whoever was signed in before, keeping only the session check', async () => {
    const { queryClient, wrapper } = createHarness();
    queryClient.setQueryData(['userAccount'], { data: { role: 'company' } });
    queryClient.setQueryData(['userProfiles'], { data: { results: [{ uuid: 'someone-else' }] } });
    queryClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
    signinMock.mockResolvedValue({ data: {} } as never);
    vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useSignIn(), { wrapper });
    fillForm(result);

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(queryClient.getQueryData(['userAccount'])).toBeUndefined();
    expect(queryClient.getQueryData(['userProfiles'])).toBeUndefined();
    expect(queryClient.getQueryData(AUTH_QUERY_KEY)).toBeDefined();

    unmount();
    queryClient.clear();
  });
});

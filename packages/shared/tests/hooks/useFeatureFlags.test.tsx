/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios from 'axios';
import type { PropsWithChildren } from 'react';

import { FEATURE_FLAG_ENDPOINTS } from '../../src/constants/api';
import { ApiClientProvider } from '../../src/hooks/useApiClient';
import { useFeatureFlags } from '../../src/hooks/useFeatureFlags';
import type { FeatureFlag } from '../../src/types';

let client: QueryClient;
let get: jest.SpyInstance;

function flag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    uuid: 'synthetic-flag',
    name: 'trading_enabled',
    description: '',
    enabled: true,
    platform: 'all',
    minAppVersion: '',
    ...overrides,
  };
}

function page(flags: FeatureFlag[]) {
  return { data: { count: flags.length, next: null, previous: null, results: flags } };
}

function harness(defaults: { refetchOnWindowFocus: boolean; refetchOnReconnect: boolean }) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, ...defaults } } });
  const apiClient = axios.create();
  get = jest.spyOn(apiClient, 'get');
  return ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

const DEFAULTS_ON = { refetchOnWindowFocus: true, refetchOnReconnect: true };

afterEach(() => {
  cleanup();
  client.clear();
  jest.restoreAllMocks();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

async function loaded(flags: FeatureFlag[]) {
  const wrapper = harness(DEFAULTS_ON);
  get.mockResolvedValue(page(flags));
  const { result } = renderHook(() => useFeatureFlags(), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return result;
}

describe('shared feature flags', () => {
  it('reads the flags endpoint once for every consumer', async () => {
    const wrapper = harness(DEFAULTS_ON);
    get.mockResolvedValue(page([flag()]));
    const { result } = renderHook(() => [useFeatureFlags(), useFeatureFlags()], { wrapper });

    await waitFor(() => expect(result.current.every(({ isEnabled }) => isEnabled('trading_enabled'))).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(FEATURE_FLAG_ENDPOINTS.BASE);
  });

  it("matches the one payload with each caller's inputs", async () => {
    const wrapper = harness(DEFAULTS_ON);
    get.mockResolvedValue(
      page([flag({ name: 'web_only', platform: 'web' }), flag({ name: 'phone', platform: 'ios' })]),
    );
    const { result } = renderHook(() => [useFeatureFlags(), useFeatureFlags({ mobilePlatform: 'ios' })] as const, {
      wrapper,
    });
    await waitFor(() => expect(result.current[0].isLoading).toBe(false));
    const [web, phone] = result.current;

    expect([web.isEnabled('web_only'), web.isEnabled('phone')]).toEqual([true, true]);
    expect([phone.isEnabled('web_only'), phone.isEnabled('phone')]).toEqual([false, true]);
    expect(phone.flags.map(({ name }) => name)).toEqual(['phone']);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('keeps every flag off until the first request settles', async () => {
    const wrapper = harness(DEFAULTS_ON);
    let release!: (value: unknown) => void;
    get.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const { result } = renderHook(() => useFeatureFlags(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isEnabled('trading_enabled')).toBe(false);
    await act(async () => release(page([flag()])));
    await waitFor(() => expect(result.current.isEnabled('trading_enabled')).toBe(true));
  });

  it('keeps every flag off when the first request fails, so a flag cannot fail open', async () => {
    const wrapper = harness(DEFAULTS_ON);
    get.mockRejectedValue(new Error('Synthetic failure'));
    const { result } = renderHook(() => useFeatureFlags(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isEnabled('trading_enabled')).toBe(false);
  });

  it('keeps the flags it read when a later refetch fails', async () => {
    const result = await loaded([flag()]);
    get.mockRejectedValue(new Error('Synthetic refetch failure'));
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isEnabled('trading_enabled')).toBe(true);
  });

  it("follows the query client's focus and reconnect policy when the caller sets none", async () => {
    const result = await loaded([flag()]);
    await client.invalidateQueries({ queryKey: ['featureFlags'], refetchType: 'none' });
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

    await client.invalidateQueries({ queryKey: ['featureFlags'], refetchType: 'none' });
    await act(async () => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    expect(result.current.isEnabled('trading_enabled')).toBe(true);
  });

  it("applies the caller's refetch policy over the query client's", async () => {
    const wrapper = harness({ refetchOnWindowFocus: true, refetchOnReconnect: false });
    get.mockResolvedValue(page([flag()]));
    const { result } = renderHook(
      () => useFeatureFlags({}, { refetchOnWindowFocus: false, refetchOnReconnect: true }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await client.invalidateQueries({ queryKey: ['featureFlags'], refetchType: 'none' });

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
});

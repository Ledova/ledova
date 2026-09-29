// @vitest-environment jsdom

import type { PropsWithChildren } from 'react';
import type { AxiosInstance } from 'axios';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, AUTH_QUERY_KEY, SIGNUP_COMPLETION_FAILED, SIGNUP_LOAD_FAILED } from '@ledova/shared';
import { useRole } from '@hooks/useRole';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

vi.mock('@hooks/useRole', () => ({ useRole: vi.fn(() => ({ role: 'investor' })) }));

import { useReview } from './useReview';

const api = { get: vi.fn(), patch: vi.fn() };
const profile = { data: { results: [{ uuid: 'profile-1' }] } };
let profileAnswers: (() => Promise<unknown>)[];
let companies: { data: { results: { uuid: string }[] } };

let queryClient: QueryClient | undefined;

const harness = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClient = client;
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  return { client, wrapper };
};

const profileReads = () => api.get.mock.calls.filter(([url]) => url === '/api/user-profiles/').length;

describe('the last click of signup', () => {
  beforeEach(() => {
    navigate.mockClear();
    api.get.mockReset();
    api.patch.mockReset();
    profileAnswers = [];
    companies = { data: { results: [] } };
    api.get.mockImplementation((url: string) => {
      if (url === '/api/user-profiles/') return (profileAnswers.shift() ?? (() => Promise.resolve(profile)))();
      if (url === '/api/financial-profiles/') return Promise.resolve({ data: { results: [{ uuid: 'financial-1' }] } });
      if (url === '/api/v1/companies/') return Promise.resolve(companies);
      if (url === '/api/v1/companies/company-1/')
        return Promise.resolve({ data: { uuid: 'company-1', abn: '51824753556' } });
      throw new Error(`Unexpected request: ${url}`);
    });
    api.patch.mockResolvedValue({ data: {} });
    vi.mocked(useRole).mockReturnValue({
      role: 'investor',
      isCompany: false,
      isInvestor: true,
      isLoading: false,
      isKnown: true,
      isUnavailable: false,
      retry: vi.fn() as unknown as ReturnType<typeof useRole>['retry'],
    });
  });

  afterEach(() => {
    queryClient?.clear();
    queryClient = undefined;
  });

  it('refreshes the answer the route guard reads before it navigates', async () => {
    const { client, wrapper } = harness();
    const refetch = vi.spyOn(client, 'refetchQueries').mockResolvedValue(undefined);
    const { result } = renderHook(() => useReview(), { wrapper });
    await waitFor(() => expect(result.current.canCompleteSignup).toBe(true));

    act(() => result.current.completeSignup());

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(refetch).toHaveBeenCalledWith({ queryKey: AUTH_QUERY_KEY, exact: true }, { throwOnError: true });
  });

  it('does not navigate until that answer is back, so the guard cannot read a stale one', async () => {
    const { client, wrapper } = harness();
    let release: () => void = () => {};
    vi.spyOn(client, 'refetchQueries').mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = renderHook(() => useReview(), { wrapper });
    await waitFor(() => expect(result.current.canCompleteSignup).toBe(true));

    act(() => result.current.completeSignup());
    await waitFor(() => expect(api.patch).toHaveBeenCalled());

    expect(navigate).not.toHaveBeenCalled();

    await act(async () => {
      release();
    });

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home'));
  });

  it('does not navigate until the profile the guard reads says sign-up is finished', async () => {
    let finish: () => void = () => {};
    profileAnswers = [
      () => Promise.resolve(profile),
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { results: [{ uuid: 'profile-1', isSignupCompleted: true }] } });
        }),
    ];
    const { client, wrapper } = harness();
    const { result } = renderHook(() => useReview(), { wrapper });
    await waitFor(() => expect(result.current.canCompleteSignup).toBe(true));

    act(() => result.current.completeSignup());
    await waitFor(() => expect(profileReads()).toBe(2));

    expect(navigate).not.toHaveBeenCalled();

    await act(async () => finish());

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/home'));
    expect(client.getQueryData(['userProfiles'])).toEqual({
      data: { results: [{ uuid: 'profile-1', isSignupCompleted: true }] },
    });
  });

  it('stays on the review when the refreshed profile cannot be read, so the guard does not read the old one', async () => {
    profileAnswers = [() => Promise.resolve(profile), () => Promise.reject(new Error('Network unavailable'))];
    const { wrapper } = harness();
    const { result } = renderHook(() => useReview(), { wrapper });
    await waitFor(() => expect(result.current.canCompleteSignup).toBe(true));

    act(() => result.current.completeSignup());

    await waitFor(() => expect(result.current.error).toBe(SIGNUP_LOAD_FAILED));
    await waitFor(() => expect(result.current.isSubmitting).toBe(false));
    expect(profileReads()).toBe(2);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says so on the review when the session cannot be checked again, so the person can retry', async () => {
    const { client, wrapper } = harness();
    vi.spyOn(client, 'refetchQueries').mockRejectedValue(new Error('Network unavailable'));
    const { result } = renderHook(() => useReview(), { wrapper });
    await waitFor(() => expect(result.current.canCompleteSignup).toBe(true));

    act(() => result.current.completeSignup());

    await waitFor(() => expect(result.current.completionError).toBe(SIGNUP_COMPLETION_FAILED));
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.canCompleteSignup).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each([
    ['investor', '/home'],
    ['company', '/company/register'],
  ] as const)('sends a %s to %s', async (role, destination) => {
    vi.mocked(useRole).mockReturnValue({
      role,
      isCompany: role === 'company',
      isInvestor: role === 'investor',
      isLoading: false,
      isKnown: true,
      isUnavailable: false,
      retry: vi.fn() as unknown as ReturnType<typeof useRole>['retry'],
    });
    companies = { data: { results: [{ uuid: 'company-1' }] } };
    const { client, wrapper } = harness();
    vi.spyOn(client, 'refetchQueries').mockResolvedValue(undefined);
    const { result } = renderHook(() => useReview(), { wrapper });
    await waitFor(() => expect(result.current.canCompleteSignup).toBe(true));

    act(() => result.current.completeSignup());

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(destination));
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import type { ReactNode } from 'react';

import { ApiClientProvider } from '../../src/hooks/useApiClient';
import { createUserFriendlyError } from '../../src/utils/errors';

export function signupApi() {
  return { get: jest.fn(), patch: jest.fn(), post: jest.fn() };
}

export function providers(api: ReturnType<typeof signupApi>, client?: QueryClient) {
  return function Providers({ children }: { children: ReactNode }) {
    const withApi = <ApiClientProvider client={api as unknown as AxiosInstance}>{children}</ApiClientProvider>;
    return client ? <QueryClientProvider client={client}>{withApi}</QueryClientProvider> : withApi;
  };
}

export function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
  });
}

export function refusal(status: number, data: unknown) {
  return { response: { status, data } };
}

export function axiosFailure(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: '' } });
}

export const TIMED_OUT = 'Request timed out. Please check your connection and try again.';
export const CANNOT_CONNECT = 'Unable to connect to our servers. Please check your internet connection and try again.';
export const SERVERS_UNAVAILABLE = 'Our servers are temporarily unavailable. Please try again in a few moments.';

export function unanswered(otherwise: string): [string, unknown, string][] {
  const original = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
  return [
    ['a timeout the app already explained', createUserFriendlyError(TIMED_OUT, original), TIMED_OUT],
    ['a lost connection the app already explained', createUserFriendlyError(CANNOT_CONNECT, original), CANNOT_CONNECT],
    [
      'a 5xx the app already explained',
      createUserFriendlyError(SERVERS_UNAVAILABLE, { response: { status: 502, data: '' } }),
      SERVERS_UNAVAILABLE,
    ],
    ['a failure with no answer and no explanation', original, otherwise],
  ];
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

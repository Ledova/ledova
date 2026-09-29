import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import type { ReactNode } from 'react';

import { ApiClientProvider } from '../../src/hooks/useApiClient';

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

export function answerless(message: string) {
  return Object.assign(new Error(message), { isUserFriendly: true });
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

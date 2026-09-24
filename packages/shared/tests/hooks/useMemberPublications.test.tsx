/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import type { PropsWithChildren } from 'react';

import { ApiClientProvider } from '../../src/hooks/useApiClient';
import { useDividends } from '../../src/hooks/useDividends';
import { PUBLICATION_SUMMARY_QUERY_KEY, usePublicationSummary } from '../../src/hooks/usePublicationSummary';

const clients: QueryClient[] = [];

function harness(respond: (url: string, config?: AxiosRequestConfig) => unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const apiClient = axios.create();
  const get = jest
    .spyOn(apiClient, 'get')
    .mockImplementation(async (url: string, config?: AxiosRequestConfig) => ({ data: respond(url, config) }));
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
  jest.restoreAllMocks();
});

describe('the publication summary a member is shown', () => {
  it('reads the summary route and says each count that is not zero', async () => {
    const { get, wrapper } = harness(() => ({
      openResolutions: 0,
      nextClosesAt: null,
      publishedSince: 2,
      dividendsWithoutRecord: 1,
    }));

    const { result } = renderHook(() => usePublicationSummary(), { wrapper });

    await waitFor(() =>
      expect(result.current.lines).toEqual([
        '2 things published to you in the last 30 days',
        '1 dividend awaiting a payment record',
      ]),
    );
    expect(get).toHaveBeenCalledWith('/api/v1/publications/summary/');
  });

  it('has nothing to say when every count is zero', async () => {
    const { client, wrapper } = harness(() => ({
      openResolutions: 0,
      nextClosesAt: null,
      publishedSince: 0,
      dividendsWithoutRecord: 0,
    }));

    const { result } = renderHook(() => usePublicationSummary(), { wrapper });

    await waitFor(() => expect(client.getQueryState(PUBLICATION_SUMMARY_QUERY_KEY)?.status).toBe('success'));
    expect(result.current.lines).toEqual([]);
  });
});

describe('the dividends a member is shown', () => {
  it('lists distributions alone, a page at a time', async () => {
    const pages: Record<number, unknown> = {
      1: {
        count: 2,
        next: 'https://api.example/api/v1/publications/?kind=distribution&page=2',
        results: [{ uuid: 'a' }],
      },
      2: { count: 2, next: null, results: [{ uuid: 'b' }] },
    };
    const { get, wrapper } = harness((_, config) => pages[config?.params?.page]);

    const { result } = renderHook(() => useDividends(), { wrapper });
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(async () => result.current.loadMore());

    await waitFor(() => expect(result.current.dividends.map((row) => row.uuid)).toEqual(['a', 'b']));
    expect(result.current.hasMore).toBe(false);
    expect(get).toHaveBeenNthCalledWith(1, '/api/v1/publications/', { params: { page: 1, kind: 'distribution' } });
    expect(get).toHaveBeenNthCalledWith(2, '/api/v1/publications/', { params: { page: 2, kind: 'distribution' } });
  });
});

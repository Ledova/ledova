/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import type { PropsWithChildren } from 'react';

import { LONGEST_TIMER_DELAY, PUBLICATION_SUMMARY_REFRESH_INTERVAL } from '../../src/constants';
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
  jest.useRealTimers();
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

describe('keeping the summary current while the home page stays open', () => {
  const START = Date.parse('2026-09-24T00:00:00Z');
  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;
  const at = (offset: number) => new Date(START + offset).toISOString();
  const nothing = { openResolutions: 0, nextClosesAt: null, publishedSince: 0, dividendsWithoutRecord: 0 };
  const voting = (closesIn: number) => ({ ...nothing, openResolutions: 1, nextClosesAt: at(closesIn) });

  beforeEach(() => {
    jest.useFakeTimers({ now: START });
  });

  const until = async (moment: number) => {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(moment - Date.now());
    });
  };

  it('reads the summary again the moment the soonest vote closes, and stops counting it', async () => {
    const answers = [voting(MINUTE), nothing];
    const { get, wrapper } = harness(() => answers.shift() ?? nothing);

    const { result } = renderHook(() => usePublicationSummary(), { wrapper });
    await waitFor(() => expect(result.current.lines).toHaveLength(1));
    expect(result.current.lines[0]).toMatch(/^1 resolution awaiting your vote, closing /);
    await until(START + MINUTE - 1);
    expect(get).toHaveBeenCalledTimes(1);
    await until(START + MINUTE);

    expect(get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.lines).toEqual([]));
  });

  it('asks again every few minutes, for what was published or recorded since', async () => {
    const answers = [nothing, { ...nothing, publishedSince: 1 }];
    const { get, wrapper } = harness(() => answers.shift() ?? nothing);

    const { result } = renderHook(() => usePublicationSummary(), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await until(START + PUBLICATION_SUMMARY_REFRESH_INTERVAL - 1);
    expect(get).toHaveBeenCalledTimes(1);
    await until(START + PUBLICATION_SUMMARY_REFRESH_INTERVAL);

    expect(get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.lines).toEqual(['1 thing published to you in the last 30 days']));
  });

  it('waits no longer than a timer can hold for a vote that closes far ahead', async () => {
    const scheduled = jest.spyOn(globalThis, 'setTimeout');
    const { wrapper } = harness(() => voting(60 * DAY));

    const { result } = renderHook(() => usePublicationSummary(), { wrapper });
    await waitFor(() => expect(result.current.lines).toHaveLength(1));

    expect(scheduled).toHaveBeenCalledWith(expect.any(Function), LONGEST_TIMER_DELAY);
  });

  it('asks nothing more once the home page is gone', async () => {
    const { get, wrapper } = harness(() => voting(MINUTE));

    const view = renderHook(() => usePublicationSummary(), { wrapper });
    await waitFor(() => expect(view.result.current.lines).toHaveLength(1));
    view.unmount();
    await until(START + 3 * PUBLICATION_SUMMARY_REFRESH_INTERVAL);

    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('the dividends a member is shown', () => {
  it('lists the distributions addressed to the member alone, a page at a time', async () => {
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
    expect(get).toHaveBeenNthCalledWith(1, '/api/v1/publications/', {
      params: { page: 1, kind: 'distribution', addressed: 'me' },
    });
    expect(get).toHaveBeenNthCalledWith(2, '/api/v1/publications/', {
      params: { page: 2, kind: 'distribution', addressed: 'me' },
    });
  });
});

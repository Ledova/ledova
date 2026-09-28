/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import type { PropsWithChildren } from 'react';

import { LONGEST_TIMER_DELAY, PUBLICATION_SUMMARY_REFRESH_INTERVAL } from '../../src/constants';
import { ApiClientProvider } from '../../src/hooks/useApiClient';
import { usePublicationSummary } from '../../src/hooks/usePublicationSummary';

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
  it('reads the summary route and gives its counts', async () => {
    const counts = { openResolutions: 0, nextClosesAt: null, dividendsWithoutRecord: 1 };
    const { get, wrapper } = harness(() => counts);

    const { result } = renderHook(() => usePublicationSummary(), { wrapper });

    await waitFor(() => expect(result.current.summary).toEqual(counts));
    expect(get).toHaveBeenCalledWith('/api/v1/publications/summary/');
    expect(result.current.isError).toBe(false);
    expect(result.current.isPending).toBe(false);
  });

  it('exposes failure and retry', async () => {
    let unavailable = true;
    const counts = { openResolutions: 1, nextClosesAt: '2026-10-01T00:00:00Z', dividendsWithoutRecord: 0 };
    const { wrapper } = harness(() => {
      if (unavailable) throw new Error('Unavailable');
      return counts;
    });
    const { result } = renderHook(() => usePublicationSummary(), { wrapper });

    expect(result.current.isPending).toBe(true);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.summary).toBeUndefined();
    unavailable = false;
    await act(async () => {
      await result.current.retry();
    });

    await waitFor(() => expect(result.current.isError).toBe(false));
    expect(result.current.summary).toEqual(counts);
  });
});

describe('keeping the summary current while the home page stays open', () => {
  const START = Date.parse('2026-09-24T00:00:00Z');
  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;
  const at = (offset: number) => new Date(START + offset).toISOString();
  const nothing = { openResolutions: 0, nextClosesAt: null, dividendsWithoutRecord: 0 };
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
    await waitFor(() => expect(result.current.summary?.openResolutions).toBe(1));
    await until(START + MINUTE - 1);
    expect(get).toHaveBeenCalledTimes(1);
    await until(START + MINUTE);

    expect(get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.summary).toEqual(nothing));
  });

  it('asks again every few minutes, for what was published or recorded since', async () => {
    const answers = [nothing, { ...nothing, dividendsWithoutRecord: 1 }];
    const { get, wrapper } = harness(() => answers.shift() ?? nothing);

    const { result } = renderHook(() => usePublicationSummary(), { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await until(START + PUBLICATION_SUMMARY_REFRESH_INTERVAL - 1);
    expect(get).toHaveBeenCalledTimes(1);
    await until(START + PUBLICATION_SUMMARY_REFRESH_INTERVAL);

    expect(get).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.summary?.dividendsWithoutRecord).toBe(1));
  });

  it('waits no longer than a timer can hold for a vote that closes far ahead', async () => {
    const scheduled = jest.spyOn(globalThis, 'setTimeout');
    const { wrapper } = harness(() => voting(60 * DAY));

    const { result } = renderHook(() => usePublicationSummary(), { wrapper });
    await waitFor(() => expect(result.current.summary).toBeDefined());

    expect(scheduled).toHaveBeenCalledWith(expect.any(Function), LONGEST_TIMER_DELAY);
  });

  it('asks nothing more once the home page is gone', async () => {
    const { get, wrapper } = harness(() => voting(MINUTE));

    const view = renderHook(() => usePublicationSummary(), { wrapper });
    await waitFor(() => expect(view.result.current.summary).toBeDefined());
    view.unmount();
    await until(START + 3 * PUBLICATION_SUMMARY_REFRESH_INTERVAL);

    expect(get).toHaveBeenCalledTimes(1);
  });
});

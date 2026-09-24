// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, PUBLICATION_COPY, formatDateTime } from '@ledova/shared';
import type { AxiosInstance } from 'axios';
import { PublishedCard } from './PublishedCard';

const get = vi.fn();
const apiClient = { get } as unknown as AxiosInstance;

const CLOSES = '2026-10-02T07:00:00Z';
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const nothing = { openResolutions: 0, nextClosesAt: null, publishedSince: 0, dividendsWithoutRecord: 0 };

let client: QueryClient;
let summary: typeof nothing | Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  summary = { openResolutions: 1, nextClosesAt: CLOSES, publishedSince: 2, dividendsWithoutRecord: 1 };
  get.mockImplementation(async () => ({ data: summary }));
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
});

function showHome() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <QueryClientProvider client={client}>
        <ApiClientProvider client={apiClient}>
          <Routes>
            <Route
              path="/home"
              element={
                <div data-testid="home">
                  <PublishedCard />
                </div>
              }
            />
            <Route path="/publications" element={<p>The publications page</p>} />
          </Routes>
        </ApiClientProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('the home card of what was published to a member', () => {
  it('says what was published, which votes close and when, and which dividends await a record', async () => {
    showHome();

    expect(await screen.findByText('2 things published to you in the last 30 days')).toBeTruthy();
    expect(screen.getByText(`1 resolution awaiting your vote, closing ${formatDateTime(CLOSES)}`)).toBeTruthy();
    expect(screen.getByText('1 dividend awaiting a payment record')).toBeTruthy();
    expect(screen.getByText(PUBLICATION_COPY.LIST_TITLE)).toBeTruthy();
    expect(get).toHaveBeenCalledWith('/api/v1/publications/summary/');
  });

  it('opens the publications page', async () => {
    showHome();

    fireEvent.click(await screen.findByText(PUBLICATION_COPY.SUMMARY_OPEN));

    expect(await screen.findByText('The publications page')).toBeTruthy();
  });

  it('updates when the soonest vote closes, while the home page stays open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const closes = new Date(Date.now() + MINUTE).toISOString();
    const answers = [{ ...nothing, openResolutions: 1, nextClosesAt: closes }, nothing];
    get.mockImplementation(async () => ({ data: answers.shift() ?? nothing }));

    showHome();
    expect(await screen.findByText(`1 resolution awaiting your vote, closing ${formatDateTime(closes)}`)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Date.parse(closes) - Date.now() - SECOND);
    });
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SECOND);
    });

    await waitFor(() => expect(screen.queryByText(PUBLICATION_COPY.LIST_TITLE)).toBeNull());
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('is not shown at all when every count is zero', async () => {
    summary = nothing;

    showHome();

    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.getByTestId('home').childElementCount).toBe(0);
    expect(screen.queryByText(PUBLICATION_COPY.LIST_TITLE)).toBeNull();
  });
});

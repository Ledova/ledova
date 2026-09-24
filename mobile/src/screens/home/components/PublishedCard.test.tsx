import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, PUBLICATION_COPY, formatDateTime } from '@ledova/shared';
import type { AxiosInstance } from 'axios';
import { PublishedCard } from './PublishedCard';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));

const CLOSES = '2026-10-02T07:00:00Z';
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const nothing = { openResolutions: 0, nextClosesAt: null, publishedSince: 0, dividendsWithoutRecord: 0 };

const get = jest.fn();
const apiClient = { get } as unknown as AxiosInstance;

let client: QueryClient;
let summary: Record<string, unknown>;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  summary = { openResolutions: 2, nextClosesAt: CLOSES, publishedSince: 1, dividendsWithoutRecord: 1 };
  get.mockImplementation(async () => ({ data: summary }));
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.useRealTimers();
});

it('says what was published, which votes close first and which dividends await a record', async () => {
  const view = await render(<PublishedCard />, { wrapper });

  expect(await view.findByText('1 thing published to you in the last 30 days')).toBeTruthy();
  expect(view.getByText(`2 resolutions awaiting your vote, the first closing ${formatDateTime(CLOSES)}`)).toBeTruthy();
  expect(view.getByText('1 dividend awaiting a payment record')).toBeTruthy();
  expect(view.getByText(PUBLICATION_COPY.LIST_TITLE)).toBeTruthy();
  expect(get).toHaveBeenCalledWith('/api/v1/publications/summary/');
});

it('opens the publications screen', async () => {
  const view = await render(<PublishedCard />, { wrapper });

  await fireEvent.press(await view.findByText(PUBLICATION_COPY.SUMMARY_OPEN));

  expect(mockNavigate).toHaveBeenCalledWith('MainApp', { screen: 'Main', params: { screen: 'Publications' } });
});

it('updates when the soonest vote closes, while the home screen stays open', async () => {
  jest.useFakeTimers({ advanceTimers: true });
  const closes = new Date(Date.now() + MINUTE).toISOString();
  const answers = [{ ...nothing, openResolutions: 1, nextClosesAt: closes }, nothing];
  get.mockImplementation(async () => ({ data: answers.shift() ?? nothing }));

  const view = await render(<PublishedCard />, { wrapper });
  expect(await view.findByText(`1 resolution awaiting your vote, closing ${formatDateTime(closes)}`)).toBeTruthy();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(Date.parse(closes) - Date.now() - SECOND);
  });
  expect(get).toHaveBeenCalledTimes(1);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(SECOND);
  });

  await waitFor(() => expect(view.toJSON()).toBeNull());
  expect(get).toHaveBeenCalledTimes(2);
});

it('is not shown at all when every count is zero', async () => {
  summary = nothing;

  const view = await render(<PublishedCard />, { wrapper });

  await waitFor(() => expect(get).toHaveBeenCalled());
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(view.toJSON()).toBeNull();
  expect(view.queryByText(PUBLICATION_COPY.LIST_TITLE)).toBeNull();
});

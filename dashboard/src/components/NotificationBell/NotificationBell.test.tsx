// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, PUBLICATION_NOTICE } from '@ledova/shared';
import type { AxiosInstance } from 'axios';
import { NotificationBell } from './index';

const get = vi.fn();
const patch = vi.fn(async () => ({ data: {} }));
const apiClient = { get, patch } as unknown as AxiosInstance;

const published = {
  uuid: 'notification-a',
  title: 'Your holding statement is ready',
  body: 'Synthetic Holdings Pty Ltd has published a holding statement.',
  isRead: false,
  createdAt: '2026-09-21T02:00:00Z',
  data: { type: PUBLICATION_NOTICE, publicationId: 'publication-a' },
};

const unrelated = {
  ...published,
  uuid: 'notification-b',
  title: 'Transaction Confirmed',
  data: { type: 'transaction' },
};

let client: QueryClient;
let rows: unknown[];

beforeEach(() => {
  vi.clearAllMocks();
  rows = [published];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  get.mockImplementation(async (url: string) =>
    url.includes('unread-count') ? { data: { count: rows.length } } : { data: { results: rows } },
  );
});

afterEach(() => {
  cleanup();
  client.clear();
});

function showBell() {
  return render(
    <MemoryRouter initialEntries={['/home']}>
      <QueryClientProvider client={client}>
        <ApiClientProvider client={apiClient}>
          <Routes>
            <Route path="/home" element={<NotificationBell />} />
            <Route path="/publications" element={<p>The publications page</p>} />
          </Routes>
        </ApiClientProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('following a notification to what it is about', () => {
  it('opens the publications page from a publication notice', async () => {
    showBell();

    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(await screen.findByText(published.title));

    expect(await screen.findByText('The publications page')).toBeTruthy();
  });

  it('leaves a notice about something else where it is', async () => {
    rows = [unrelated];

    showBell();
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(await screen.findByText(unrelated.title));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/notifications/notification-b/', { is_read: true }));
    expect(screen.queryByText('The publications page')).toBeNull();
    expect(screen.getByText(unrelated.title)).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, PUBLICATION_NOTICE } from '@ledova/shared';
import type { AxiosInstance } from 'axios';
import { NotificationBell } from './index';

const get = vi.fn();
const patch = vi.fn<(url: string, body: unknown) => Promise<{ data: object }>>();
const post = vi.fn<(url: string) => Promise<{ data: object }>>();
const apiClient = { get, patch, post } as unknown as AxiosInstance;
const LIST = '/api/notifications/';

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
  title: 'Scheduled maintenance',
  data: { type: 'system' },
};

let client: QueryClient;
let rows: { uuid: string; title: string; isRead: boolean; data?: unknown }[];

beforeEach(() => {
  vi.clearAllMocks();
  patch.mockImplementation(async () => ({ data: {} }));
  post.mockImplementation(async () => ({ data: {} }));
  rows = [published];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  get.mockImplementation(async (url: string) =>
    url.includes('unread-count')
      ? { data: { unreadCount: rows.filter((row) => !row.isRead).length } }
      : { data: { results: rows } },
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
          <NotificationBell align="end" />
          <Routes>
            <Route path="/home" element={<p>The home page</p>} />
            <Route path="/publications" element={<p>The publications page</p>} />
            <Route path="/company/listing" element={<p>The application page</p>} />
            <Route path="/company/offering" element={<p>The offerings page</p>} />
            <Route path="/transactions" element={<p>The activity page</p>} />
            <Route path="/user-profile" element={<p>The profile page</p>} />
          </Routes>
        </ApiClientProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('following a notification to what it is about', () => {
  it('opens the publications page from a publication notice', async () => {
    showBell();

    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    fireEvent.click(await screen.findByText(published.title));

    expect(await screen.findByText('The publications page')).toBeTruthy();
  });

  it.each([
    ['distribution', 'A dividend has been declared'],
    ['resolution', 'A resolution has been put to members'],
  ])('opens the publications page from the notice of a new %s', async (kind, title) => {
    rows = [{ ...published, title, data: { type: PUBLICATION_NOTICE, event: 'published', publicationId: 'b', kind } }];

    showBell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    fireEvent.click(await screen.findByText(title));

    expect(await screen.findByText('The publications page')).toBeTruthy();
  });

  it('leaves a notice about something else where it is', async () => {
    rows = [unrelated];

    showBell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    fireEvent.click(await screen.findByText(unrelated.title));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/notifications/notification-b/', { is_read: true }));
    expect(screen.queryByText('The publications page')).toBeNull();
    expect(screen.getByText(unrelated.title)).toBeTruthy();
  });
});

describe('every kind of notice opens its own page', () => {
  it.each([
    ['a company application', 'company', 'The application page'],
    ['an offering', 'offering', 'The offerings page'],
    ['a transaction', 'transaction', 'The activity page'],
    ['an identity check', 'identity', 'The profile page'],
  ])('opens the right page from a notice about %s, and closes the panel', async (_, type, page) => {
    rows = [{ ...published, title: `A ${type} notice`, data: { type, event: 'changed' } }];

    showBell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    fireEvent.click(await screen.findByText(`A ${type} notice`));

    expect(await screen.findByText(page)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(`A ${type} notice`)).toBeNull());
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/api/notifications/${published.uuid}/`, { is_read: true }));
  });
});

describe('the bell itself', () => {
  it('says how many notices are unread in its name, and just Notifications when none are', async () => {
    showBell();
    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeTruthy();

    cleanup();
    client.clear();
    rows = [];
    showBell();
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy();
  });

  it('offers a named way to dismiss each notice, which archives it and takes it out of the open panel', async () => {
    patch.mockImplementationOnce(async () => {
      rows = [];
      return { data: {} };
    });
    showBell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    fireEvent.click(await screen.findByRole('button', { name: `Dismiss ${published.title}` }));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(`/api/notifications/${published.uuid}/`, { is_archived: true }),
    );
    expect(await screen.findByText('No notifications yet')).toBeTruthy();
    expect(screen.queryByText(published.title)).toBeNull();
  });

  it('lists the notices when opened from the keyboard, as it does when clicked', async () => {
    showBell();
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });

    bell.focus();
    fireEvent.keyDown(bell, { key: 'Enter' });

    expect(await screen.findByText(published.title)).toBeTruthy();
  });

  it('opens its panel outside the bar that holds it, so nothing around the bell clips the panel', async () => {
    const { container } = showBell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));

    const notice = await screen.findByText(published.title);

    expect(container.contains(screen.getByRole('button', { name: 'Notifications, 1 unread' }))).toBe(true);
    expect(container.contains(notice)).toBe(false);
  });
});

describe('the open panel after a change', () => {
  const third = { ...published, uuid: 'notification-c', title: 'A third notice', data: { type: 'system' } };
  const listReads = () => get.mock.calls.filter(([url]) => url === LIST).length;
  const noticeButton = (title: string) => screen.getByText(title).closest('button')!;

  it('moves focus to the next notice when one is dismissed, then to the heading once none remain', async () => {
    rows = [published, unrelated, third];
    patch.mockImplementation(async (url: string) => {
      rows = rows.filter((row) => url !== `/api/notifications/${row.uuid}/`);
      return { data: {} };
    });
    showBell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 3 unread' }));
    const dismiss = async (title: string) => {
      const button = await screen.findByRole('button', { name: `Dismiss ${title}` });
      button.focus();
      fireEvent.click(button);
      await waitFor(() => expect(screen.queryByText(title)).toBeNull());
    };

    await dismiss(published.title);
    expect(document.activeElement).toBe(noticeButton(unrelated.title));
    await dismiss(third.title);
    expect(document.activeElement).toBe(noticeButton(unrelated.title));
    await dismiss(unrelated.title);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Notifications' }));
  });

  it('reloads the list and the count after one notice is read', async () => {
    rows = [unrelated];
    patch.mockImplementationOnce(async () => {
      rows = [{ ...unrelated, isRead: true }];
      return { data: {} };
    });
    showBell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    await screen.findByText(unrelated.title);
    const before = listReads();

    fireEvent.click(noticeButton(unrelated.title));

    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy();
    await waitFor(() => expect(listReads()).toBe(before + 1));
  });

  it('reloads the list and the count after marking all as read, and keeps focus in the panel', async () => {
    rows = [published, unrelated];
    post.mockImplementationOnce(async () => {
      rows = rows.map((row) => ({ ...row, isRead: true }));
      return { data: {} };
    });
    showBell();
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    await screen.findByText(unrelated.title);
    const before = listReads();
    const markAll = screen.getByRole('button', { name: 'Mark all as read' });
    markAll.focus();

    fireEvent.click(markAll);

    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy();
    expect(post).toHaveBeenCalledWith('/api/notifications/mark-all-read/');
    await waitFor(() => expect(listReads()).toBe(before + 1));
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Notifications' }));
  });
});

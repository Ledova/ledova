import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, PUBLICATION_NOTICE } from '@ledova/shared';
import type { Notification } from '@ledova/shared';
import type { AxiosInstance } from 'axios';
import { NotificationsModal, destinationOf } from './NotificationsModal';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));

const LIST = '/api/notifications/';
const get = jest.fn();
const patch = jest.fn();
const post = jest.fn();
const apiClient = { get, patch, post } as unknown as AxiosInstance;
let client: QueryClient;
let rows: { uuid: string; title: string; body: string; isRead: boolean; createdAt: string; data: unknown }[];

function notice(data: unknown): Notification {
  return {
    uuid: 'notification-a',
    title: 'Your holding statement is ready',
    body: 'Synthetic Holdings Pty Ltd has published a holding statement.',
    isRead: false,
    createdAt: '2026-09-21T02:00:00Z',
    data,
  } as unknown as Notification;
}

it('sends a publication notice to the publications screen', () => {
  expect(destinationOf(notice({ type: PUBLICATION_NOTICE, publicationId: 'publication-a' }))).toBe('Publications');
});

it.each(['distribution', 'resolution'])('sends the notice of a new %s to the publications screen', (kind) => {
  expect(destinationOf(notice({ type: PUBLICATION_NOTICE, event: 'published', publicationId: 'b', kind }))).toBe(
    'Publications',
  );
});

it('sends a notice about something else nowhere', () => {
  expect(destinationOf(notice({ type: 'transaction', transactionId: 'transaction-a' }))).toBeUndefined();
  expect(destinationOf(notice({}))).toBeUndefined();
  expect(destinationOf(notice(null))).toBeUndefined();
});

describe('the open modal after a change', () => {
  const first = {
    uuid: 'notification-a',
    title: 'Your holding statement is ready',
    body: 'Synthetic Holdings Pty Ltd has published a holding statement.',
    isRead: false,
    createdAt: '2026-09-21T02:00:00Z',
    data: { type: 'system' },
  };
  const second = { ...first, uuid: 'notification-b', title: 'Scheduled maintenance' };
  const listReads = () => get.mock.calls.filter(([url]) => url === LIST).length;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } },
    });
    rows = [first, second];
    get.mockImplementation(async (url: string) =>
      url.includes('unread-count')
        ? { data: { unreadCount: rows.filter((row) => !row.isRead).length } }
        : { data: { results: rows } },
    );
    patch.mockImplementation(async (url: string, body: { is_read?: boolean; is_archived?: boolean }) => {
      rows = body.is_archived
        ? rows.filter((row) => url !== `${LIST}${row.uuid}/`)
        : rows.map((row) => (url === `${LIST}${row.uuid}/` ? { ...row, isRead: true } : row));
      return { data: {} };
    });
    post.mockImplementation(async () => {
      rows = rows.map((row) => ({ ...row, isRead: true }));
      return { data: {} };
    });
  });

  afterEach(async () => {
    await cleanup();
    client.clear();
  });

  const open = () =>
    render(
      <QueryClientProvider client={client}>
        <ApiClientProvider client={apiClient}>
          <NotificationsModal visible onClose={jest.fn()} />
        </ApiClientProvider>
      </QueryClientProvider>,
    );

  it('takes a dismissed notice out of the open modal', async () => {
    const view = await open();
    await fireEvent.press(await view.findByRole('button', { name: `Dismiss ${first.title}` }));

    await waitFor(() => expect(view.queryByText(first.title)).toBeNull());
    expect(patch).toHaveBeenCalledWith(`${LIST}${first.uuid}/`, { is_archived: true });
    expect(view.getByText(second.title)).toBeTruthy();
  });

  it('reloads the list and the count after one notice is read', async () => {
    const view = await open();
    await fireEvent.press(await view.findByText(first.title));

    await waitFor(() => expect(patch).toHaveBeenCalledWith(`${LIST}${first.uuid}/`, { is_read: true }));
    await waitFor(() => expect(listReads()).toBe(2));
    expect(view.getByRole('button', { name: 'Mark all as read' })).toBeTruthy();
  });

  it('reloads the list and the count after marking all as read', async () => {
    const view = await open();
    await fireEvent.press(await view.findByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => expect(view.queryByRole('button', { name: 'Mark all as read' })).toBeNull());
    expect(post).toHaveBeenCalledWith('/api/notifications/mark-all-read/');
    expect(listReads()).toBe(2);
    expect(view.getByText(first.title)).toBeTruthy();
  });
});

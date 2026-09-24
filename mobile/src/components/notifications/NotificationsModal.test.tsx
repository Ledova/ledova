import { PUBLICATION_NOTICE } from '@ledova/shared';
import type { Notification } from '@ledova/shared';
import { destinationOf } from './NotificationsModal';

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

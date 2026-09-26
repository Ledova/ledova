import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellIcon, XIcon } from '@phosphor-icons/react';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { formatDateTime, DESIGN_TOKENS, DESTINATIONS, PUBLICATION_NOTICE, useNotifications } from '@ledova/shared';
import type { DestinationKey, Notification } from '@ledova/shared';

const ICON_SM = DESIGN_TOKENS.icon.sizes.sm;
const ICON_MD = DESIGN_TOKENS.icon.sizes.md;

const NOTICE_PAGES: Record<string, DestinationKey> = {
  company: 'companyListing',
  offering: 'companyOffering',
  [PUBLICATION_NOTICE]: 'publications',
  transaction: 'transactions',
  identity: 'userProfile',
};

function destinationOf(notification: Notification): string | undefined {
  const type = (notification.data as { type?: unknown } | null | undefined)?.type;
  const page = typeof type === 'string' ? NOTICE_PAGES[type] : undefined;
  return page && DESTINATIONS[page].path;
}

interface NotificationBellProps {
  align: 'start' | 'end';
}

function NotificationItem({
  notification,
  onRead,
  onArchive,
  onFollow,
}: {
  notification: Notification;
  onRead: (uuid: string) => void;
  onArchive: (uuid: string) => void;
  onFollow: (notification: Notification) => void;
}) {
  return (
    <div className="relative border-b border-border-subtle last:border-b-0 hover:bg-surface-base">
      <button
        onClick={() => {
          if (!notification.isRead) onRead(notification.uuid);
          onFollow(notification);
        }}
        className="flex w-full items-start gap-3 py-3 pl-4 pr-11 text-left"
      >
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${notification.isRead ? '' : 'bg-brand-mid'}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text-primary">{notification.title}</span>
          <span className="mt-0.5 line-clamp-2 text-xs text-text-muted">{notification.body}</span>
          <span className="mt-1 block text-xs text-text-subtle">{formatDateTime(notification.createdAt)}</span>
        </span>
      </button>
      <button
        onClick={() => onArchive(notification.uuid)}
        aria-label={`Dismiss ${notification.title}`}
        className="absolute right-3 top-3 rounded-md p-1 text-text-subtle transition-colors hover:bg-surface-tertiary hover:text-text-primary"
      >
        <XIcon size={ICON_SM} aria-hidden="true" />
      </button>
    </div>
  );
}

function NotificationList({
  load,
  notifications,
  isLoading,
  onRead,
  onArchive,
  onFollow,
}: {
  load: () => unknown;
  notifications: Notification[];
  isLoading: boolean;
  onRead: (uuid: string) => void;
  onArchive: (uuid: string) => void;
  onFollow: (notification: Notification) => void;
}) {
  useEffect(() => {
    load();
  }, [load]);

  if (isLoading && notifications.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-text-muted">Loading...</p>;
  }
  if (notifications.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-text-muted">No notifications yet</p>;
  }
  return (
    <>
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.uuid}
          notification={notification}
          onRead={onRead}
          onArchive={onArchive}
          onFollow={onFollow}
        />
      ))}
    </>
  );
}

export function NotificationBell({ align }: NotificationBellProps) {
  const navigate = useNavigate();
  const {
    unreadCount,
    notifications,
    isLoadingNotifications,
    fetchNotifications,
    markAsRead,
    archive,
    markAllAsRead,
    isMarkingAllRead,
  } = useNotifications();

  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  const follow = (notification: Notification, close: () => void) => {
    const destination = destinationOf(notification);
    if (!destination) return;
    navigate(destination);
    close();
  };

  return (
    <Popover>
      <PopoverButton
        aria-label={unreadCount > 0 ? `Notifications, ${badgeText} unread` : 'Notifications'}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-mid/30"
      >
        <BellIcon size={ICON_MD} aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white"
          >
            {badgeText}
          </span>
        )}
      </PopoverButton>

      <PopoverPanel
        anchor={align === 'start' ? 'bottom start' : 'bottom end'}
        transition
        className="z-50 w-80 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg transition [--anchor-gap:8px] data-[closed]:opacity-0 data-[enter]:duration-150 data-[leave]:duration-100"
      >
        {({ close }) => (
          <>
            <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
              <span className="text-sm font-medium text-text-primary">Notifications</span>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllAsRead()}
                  disabled={isMarkingAllRead}
                  className="text-xs text-brand-light transition-colors hover:text-brand-subtle disabled:opacity-50"
                >
                  Mark all as read
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto">
              <NotificationList
                load={fetchNotifications}
                notifications={notifications}
                isLoading={isLoadingNotifications}
                onRead={markAsRead}
                onArchive={archive}
                onFollow={(followed) => follow(followed, close)}
              />
            </div>
          </>
        )}
      </PopoverPanel>
    </Popover>
  );
}

export default NotificationBell;

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { USER_PREFERENCES_QUERY_KEY, type useMemberRecords } from '@ledova/shared';

export function useMemberFreshness(read: ReturnType<typeof useMemberRecords>, enabled = true) {
  const client = useQueryClient();
  const current = useRef(read);
  const resume = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    current.current = read;
  }, [read]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let running = false;
    let pending = false;
    let scheduled: number | undefined;
    const available = () =>
      active &&
      !!current.current.owner &&
      !current.current.busy &&
      !current.current.refreshing &&
      !document.hidden &&
      navigator.onLine !== false;
    const schedule = (delay = 0) => {
      if (scheduled !== undefined || running || !available()) return;
      scheduled = window.setTimeout(() => {
        scheduled = undefined;
        void run();
      }, delay);
    };
    const run = async () => {
      if (!pending || running || !available()) return;
      const owner = current.current.owner!;
      if (
        client.isFetching({ queryKey: ['member-records', owner.userUuid, owner.ownerAccountUuid] }) ||
        client.isFetching({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true })
      ) {
        schedule(250);
        return;
      }
      running = true;
      pending = false;
      try {
        await current.current.refresh();
      } finally {
        running = false;
        if (pending) schedule();
      }
    };
    const request = () => {
      pending = true;
      schedule();
    };
    resume.current = () => {
      if (pending) schedule();
    };
    const interval = window.setInterval(request, 60_000);
    window.addEventListener('focus', request);
    window.addEventListener('online', request);
    document.addEventListener('visibilitychange', request);
    return () => {
      active = false;
      if (scheduled !== undefined) window.clearTimeout(scheduled);
      window.clearInterval(interval);
      window.removeEventListener('focus', request);
      window.removeEventListener('online', request);
      document.removeEventListener('visibilitychange', request);
      resume.current = () => {};
    };
  }, [client, enabled]);
  useEffect(() => {
    if (enabled) resume.current();
  }, [read.owner, read.busy, read.refreshing, enabled]);
}

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { USER_PREFERENCES_QUERY_KEY, type OrderSubmissionOwner, type RegisterAward } from '@ledova/shared';
import { ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { registerClassesKey, registerHoldersKey } from '@pages/company/shared/useCompanyRegister';
import { grantsKey } from './shared/useRegisterGrants';
import { awardsKey, awardVestingsKey, awardEndsKey, awardVestingReversalsKey } from './shared/useRegisterAwards';
import { peopleKey } from './shared/usePeople';

export function useAwardFreshness({
  owner,
  token,
  guard,
  active,
  sourceReady,
  held,
  refreshRecords,
}: {
  owner: OrderSubmissionOwner;
  token: string;
  guard: () => void;
  active: boolean;
  sourceReady: boolean;
  held: boolean;
  refreshRecords: (available: () => boolean) => Promise<unknown>;
}) {
  const client = useQueryClient();
  const current = useRef({ active, sourceReady, held, refreshRecords });
  const resume = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    current.current = { active, sourceReady, held, refreshRecords };
  }, [active, sourceReady, held, refreshRecords]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    let running = false;
    let pending = true;
    let scheduled: number | undefined;
    const available = () =>
      live &&
      current.current.active &&
      current.current.sourceReady &&
      !current.current.held &&
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
      const records = client.getQueryData<RegisterAward[]>(awardsKey(owner, token)) ?? [];
      const keys = [
        ownAppointmentsKey(owner),
        registerClassesKey(owner),
        registerHoldersKey(owner),
        USER_PREFERENCES_QUERY_KEY,
        awardsKey(owner, token),
        grantsKey(owner, token),
        peopleKey(owner, token),
        ...records.flatMap((award) => [
          awardVestingsKey(owner, award.uuid),
          awardEndsKey(owner, award.uuid),
          awardVestingReversalsKey(owner, award.uuid),
        ]),
      ];
      if (keys.some((queryKey) => client.isFetching({ queryKey }))) {
        schedule(250);
        return;
      }
      running = true;
      pending = false;
      try {
        guard();
        await current.current.refreshRecords(available);
      } catch {
        return;
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
    schedule();
    return () => {
      live = false;
      if (scheduled !== undefined) window.clearTimeout(scheduled);
      window.clearInterval(interval);
      window.removeEventListener('focus', request);
      window.removeEventListener('online', request);
      document.removeEventListener('visibilitychange', request);
      resume.current = () => {};
    };
  }, [client, owner, token, guard, active]);
  useEffect(() => resume.current(), [sourceReady, held]);
}

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  hasCurrentRegisterReadAuthority,
  USER_PREFERENCES_QUERY_KEY,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { registerClassesKey, registerHoldersKey } from '@hooks/useRegisterClasses';
import { grantsKey } from './shared/useRegisterGrants';
import { allotmentsKey } from './useRegisterAllotments';
import { awardsKey } from './shared/useRegisterAwards';
import { entriesKey } from './shared/useRegisterEntries';
import { allPeopleKey } from './shared/usePeople';

export function useIssueEntryRead({
  owner,
  company,
  token,
  guard,
  visible,
  sourceReady,
  refreshRecords,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  token: string;
  guard: () => void;
  visible: boolean;
  sourceReady: boolean;
  refreshRecords: () => Promise<unknown>;
}) {
  const client = useQueryClient();
  const current = useRef({ sourceReady, visible, refreshRecords });
  const resume = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    current.current = { sourceReady, visible, refreshRecords };
  }, [sourceReady, visible, refreshRecords]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let running = false;
    let pending = true;
    let scheduled: number | undefined;
    const keys = [grantsKey(owner, token), allotmentsKey(owner, token)];
    const available = () => active && current.current.visible;
    const ready = () => available() && current.current.sourceReady;
    const schedule = (delay = 0) => {
      if (scheduled !== undefined || running || !ready()) return;
      scheduled = window.setTimeout(() => {
        scheduled = undefined;
        void run();
      }, delay);
    };
    const run = async () => {
      if (!pending || running || !ready()) return;
      if (
        client.isFetching({ queryKey: registerClassesKey(owner), exact: true }) ||
        client.isFetching({ queryKey: registerHoldersKey(owner) }) ||
        client.isFetching({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true })
      ) {
        schedule(250);
        return;
      }
      running = true;
      pending = false;
      try {
        guard();
        await client.refetchQueries(
          { queryKey: ownAppointmentsKey(owner), exact: true },
          { cancelRefetch: false, throwOnError: true },
        );
        if (!available()) return;
        guard();
        if (!current.current.sourceReady) {
          pending = true;
          return;
        }
        const appointments = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
        if (
          appointments?.status !== 'success' ||
          appointments.fetchStatus !== 'idle' ||
          !hasCurrentRegisterReadAuthority(appointments.data ?? [], company)
        )
          return;
        const previous = keys.map((key) => client.getQueryData(key));
        await current.current.refreshRecords();
        if (!available()) return;
        guard();
        if (keys.some((key, index) => previous[index] !== client.getQueryData(key)))
          await Promise.all(
            [registerHoldersKey(owner), awardsKey(owner, token), entriesKey(owner, token), allPeopleKey(owner)].map(
              (queryKey) => client.invalidateQueries({ queryKey }, { cancelRefetch: false }),
            ),
          );
      } catch {
        return;
      } finally {
        running = false;
        if (pending) schedule();
      }
    };
    resume.current = () => {
      if (pending) schedule();
    };
    schedule();
    return () => {
      active = false;
      if (scheduled !== undefined) window.clearTimeout(scheduled);
      resume.current = () => {};
    };
  }, [client, owner, company, token, guard, visible]);
  useEffect(() => resume.current(), [sourceReady]);
}

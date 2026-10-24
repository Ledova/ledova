import { useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  hasCurrentRegisterReadAuthority,
  USER_PREFERENCES_QUERY_KEY,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { registerAppointmentsKey, registerClassesKey, registerHoldersKey } from '../../hooks/useCompanyRegister';
import { assertSessionEpoch } from '../../services/sessionScope';

export function useTaskFreshness({
  epoch,
  company,
  visible,
  sourceReady,
  paused,
  records,
  related,
  refreshRecords,
  interval,
}: {
  epoch: number;
  company: string;
  visible: boolean;
  sourceReady: boolean;
  paused: boolean;
  records: QueryKey[];
  related: QueryKey[];
  refreshRecords: () => Promise<unknown>;
  interval?: number;
}) {
  const client = useQueryClient();
  const current = useRef({ sourceReady, visible, paused, records, related, refreshRecords });
  const resume = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    current.current = { sourceReady, visible, paused, records, related, refreshRecords };
  }, [sourceReady, visible, paused, records, related, refreshRecords]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let running = false;
    let pending = true;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const available = () => active && current.current.visible && AppState.currentState === 'active';
    const ready = () => available() && current.current.sourceReady && !current.current.paused;
    const schedule = (delay = 0) => {
      if (scheduled !== undefined || running || !ready()) return;
      scheduled = setTimeout(() => {
        scheduled = undefined;
        void run();
      }, delay);
    };
    const run = async () => {
      if (!pending || running || !ready()) return;
      if (
        client.isFetching({ queryKey: registerClassesKey(epoch), exact: true }) ||
        client.isFetching({ queryKey: registerHoldersKey(epoch) }) ||
        client.isFetching({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true })
      ) {
        schedule(250);
        return;
      }
      running = true;
      pending = false;
      try {
        assertSessionEpoch(epoch);
        await client.refetchQueries(
          { queryKey: registerAppointmentsKey(epoch), exact: true },
          { cancelRefetch: false, throwOnError: true },
        );
        if (!available()) return;
        assertSessionEpoch(epoch);
        if (!current.current.sourceReady || current.current.paused) {
          pending = true;
          return;
        }
        const appointments = client.getQueryState<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch));
        if (
          appointments?.status !== 'success' ||
          appointments.fetchStatus !== 'idle' ||
          !hasCurrentRegisterReadAuthority(appointments.data ?? [], company)
        )
          return;
        const { records, related } = current.current;
        const previous = records.map((key) => client.getQueryData(key));
        await current.current.refreshRecords();
        if (!available()) return;
        assertSessionEpoch(epoch);
        if (records.some((key, index) => previous[index] !== client.getQueryData(key)))
          await Promise.all(
            related.map((queryKey) => client.invalidateQueries({ queryKey }, { cancelRefetch: false })),
          );
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
    const timer = interval === undefined ? undefined : setInterval(request, interval);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') request();
    });
    schedule();
    return () => {
      active = false;
      if (scheduled !== undefined) clearTimeout(scheduled);
      if (timer !== undefined) clearInterval(timer);
      subscription.remove();
      resume.current = () => {};
    };
  }, [client, epoch, company, visible, interval]);
  useEffect(() => resume.current(), [sourceReady, paused]);
}

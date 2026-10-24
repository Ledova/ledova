import { useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  hasCurrentRegisterReadAuthority,
  USER_PREFERENCES_QUERY_KEY,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import {
  entriesKey,
  grantsKey,
  registerAppointmentsKey,
  registerClassesKey,
  registerHoldersKey,
  transferMembersKey,
} from '../../hooks/useCompanyRegister';
import { assertSessionEpoch } from '../../services/sessionScope';
import { allotmentsKey } from './useRegisterAllotments';
import { awardsKey } from './useRegisterAwards';

export function useIssueFreshness({
  epoch,
  company,
  token,
  visible,
  sourceReady,
  paused,
  refreshRecords,
}: {
  epoch: number;
  company: string;
  token: string;
  visible: boolean;
  sourceReady: boolean;
  paused: boolean;
  refreshRecords: () => Promise<unknown>;
}) {
  const client = useQueryClient();
  const current = useRef({ sourceReady, visible, paused, refreshRecords });
  const resume = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    current.current = { sourceReady, visible, paused, refreshRecords };
  }, [sourceReady, visible, paused, refreshRecords]);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    let running = false;
    let pending = true;
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    const keys = [grantsKey(epoch, token), allotmentsKey(epoch, token)];
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
        const previous = keys.map((key) => client.getQueryData(key));
        await current.current.refreshRecords();
        if (!available()) return;
        assertSessionEpoch(epoch);
        if (keys.some((key, index) => previous[index] !== client.getQueryData(key)))
          await Promise.all(
            [
              registerHoldersKey(epoch),
              awardsKey(epoch, token),
              entriesKey(epoch, token),
              transferMembersKey(epoch, token),
            ].map((queryKey) => client.invalidateQueries({ queryKey }, { cancelRefetch: false })),
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
    const interval = setInterval(request, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') request();
    });
    schedule();
    return () => {
      active = false;
      if (scheduled !== undefined) clearTimeout(scheduled);
      clearInterval(interval);
      subscription.remove();
      resume.current = () => {};
    };
  }, [client, epoch, company, token, visible]);
  useEffect(() => resume.current(), [sourceReady, paused]);
}

import { useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AxiosRequestConfig } from 'axios';
import type { UserPreferences } from '../types';
import { AUTH_QUERY_KEY } from './useAuth';
import { USER_PREFERENCES_QUERY_KEY, useUserPreferences } from './useUserPreferences';

declare module 'axios' {
  interface AxiosRequestConfig {
    ledovaSubmissionGuard?: () => void;
  }
}

export interface OrderSubmissionOwner {
  userUuid: string;
  ownerAccountUuid: string;
}

export interface OrderSubmissionSession {
  getEpoch: () => number;
  subscribe: (listener: () => void) => () => void;
  requestConfig: () => AxiosRequestConfig;
}

export function useSubmissionOwner(session?: OrderSubmissionSession) {
  const queryClient = useQueryClient();
  useUserPreferences();
  const boundary = useMemo(() => {
    let key: string | null = null;
    let value: OrderSubmissionOwner | null = null;
    const get = (): OrderSubmissionOwner | null => {
      const auth = queryClient.getQueryData<{ data: { valid: boolean } }>(AUTH_QUERY_KEY);
      const preferences = queryClient.getQueryData<{ data: UserPreferences }>(USER_PREFERENCES_QUERY_KEY)?.data;
      const authorized = queryClient.getQueryState(AUTH_QUERY_KEY)?.status === 'success' && auth?.data.valid;
      const next =
        authorized && preferences?.userProfile && preferences.userAccount
          ? `${preferences.userProfile}/${preferences.userAccount.uuid}/${session?.getEpoch() ?? 0}`
          : null;
      if (key !== next) {
        key = next;
        value =
          next && preferences?.userAccount
            ? { userUuid: preferences.userProfile, ownerAccountUuid: preferences.userAccount.uuid }
            : null;
      }
      return value;
    };
    return {
      get,
      subscribe: (listener: () => void) => {
        let notified = get();
        const changed = () => {
          const next = get();
          if (next === notified) return;
          notified = next;
          listener();
        };
        const unsubscribeQuery = queryClient.getQueryCache().subscribe(changed);
        const unsubscribeSession = session?.subscribe(changed);
        return () => {
          unsubscribeQuery();
          unsubscribeSession?.();
        };
      },
    };
  }, [queryClient, session]);
  const owner = useSyncExternalStore(boundary.subscribe, boundary.get, boundary.get);
  return { owner, boundary };
}

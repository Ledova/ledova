import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptMemberInvitation,
  getOwnMemberEntries,
  getOwnMemberRecord,
  getOwnMemberRecords,
} from '../services/member-access';
import type { OwnMemberRecord } from '../types';
import { failureStatus, failureSentence } from '../utils/errors';
import { readEveryPage } from '../utils/pagination';
import { useSubmissionOwner } from './useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY } from './useUserPreferences';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';
import { useApiClient } from './useApiClient';

type Command = { code: string; userAccount: string; confirmation: true };

export function ownMemberRecordsKey(owner: OrderSubmissionOwner | null, epoch = 0) {
  return ['member-records', owner?.userUuid, owner?.ownerAccountUuid, epoch] as const;
}

export function useMemberRecords(
  session?: OrderSubmissionSession,
  {
    coordinatedRefresh = false,
    enabled = true,
    readList = true,
  }: { coordinatedRefresh?: boolean; enabled?: boolean; readList?: boolean } = {},
) {
  const api = useApiClient();
  const client = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(session);
  const [selected, setSelected] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<Command | null>(null);
  const pending = useRef(false);
  const live = useRef(true);
  const current = useRef({ selected, token, owner });
  current.current = { selected, token, owner };
  const key = ownMemberRecordsKey(owner, session?.getEpoch() ?? 0);
  const detailKey = [...key, selected];
  const entriesKey = [...detailKey, 'entries', token];
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const [selectionOwner, setSelectionOwner] = useState(owner);
  if (selectionOwner !== owner) {
    setSelectionOwner(owner);
    setSelected('');
    setToken('');
    setRetry(null);
    setError(null);
    setRefreshing(false);
  }
  const guard = () => {
    const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    if (
      !live.current ||
      !owner ||
      boundary.get() !== owner ||
      preferences?.status !== 'success' ||
      preferences.fetchStatus !== 'idle'
    )
      throw new Error('Your signed-in account changed. Reopen your member records.');
  };
  const config = (check = guard) => ({ ...session?.requestConfig(), ledovaSubmissionGuard: check });
  const refreshOptions = coordinatedRefresh ? { refetchOnWindowFocus: false, refetchOnReconnect: false } : {};
  const list = useQuery({
    ...refreshOptions,
    queryKey: key,
    enabled: enabled && readList && !!owner,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const response = await getOwnMemberRecords(api, page, config());
        guard();
        return response;
      }),
  });
  const guardList = () => {
    guard();
    const state = client.getQueryState(key);
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw new Error('Refresh your current member associations before continuing.');
  };
  const guardSelection = () => {
    guardList();
    if (
      current.current.selected !== selected ||
      !client.getQueryData<OwnMemberRecord[]>(key)?.some((row) => row.uuid === selected)
    )
      throw new Error('Your member association changed.');
  };
  const detail = useQuery({
    ...refreshOptions,
    queryKey: detailKey,
    enabled: enabled && !!selected && list.isSuccess && !list.isFetching,
    queryFn: async () => {
      guardSelection();
      const { data } = await getOwnMemberRecord(api, selected, config(guardSelection));
      guardSelection();
      const summary = client.getQueryData<OwnMemberRecord[]>(key)?.find((row) => row.uuid === selected);
      if (
        data.uuid !== selected ||
        data.member !== summary?.member ||
        data.company.uuid !== summary.company.uuid ||
        data.identitySource !== 'company_recorded'
      )
        throw new Error('The member record does not identify your selected association.');
      return data;
    },
  });
  const guardRecord = () => {
    guardSelection();
    const state = client.getQueryState(detailKey);
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw new Error('Refresh the selected member record before continuing.');
  };
  const entries = useQuery({
    ...refreshOptions,
    queryKey: entriesKey,
    enabled:
      enabled &&
      !!token &&
      !!selected &&
      detail.isSuccess &&
      !detail.isFetching &&
      list.isSuccess &&
      !list.isFetching &&
      detail.data.classes.some((row) => row.uuid === token),
    queryFn: async () => {
      const check = () => {
        guardRecord();
        if (
          current.current.token !== token ||
          !client.getQueryData<OwnMemberRecord>(detailKey)?.classes.some((row) => row.uuid === token)
        )
          throw new Error('The selected share class changed.');
      };
      check();
      const { data } = await getOwnMemberEntries(api, selected, token, config(check));
      check();
      if (!Array.isArray(data.entries) || data.entries.some((row) => !/^-?\d+$/.test(row.delta)))
        throw new Error('The own entry deltas could not be confirmed.');
      return data.entries;
    },
  });
  const refresh = async () => {
    guard();
    if (coordinatedRefresh) setRefreshing(true);
    try {
      await list.refetch({ throwOnError: true });
      if (selected) {
        guardSelection();
        await detail.refetch({ throwOnError: true });
        const hasToken =
          !!token && client.getQueryData<OwnMemberRecord>(detailKey)?.classes.some((row) => row.uuid === token);
        if (token && !hasToken) setToken('');
        if (hasToken) await entries.refetch({ throwOnError: true });
      }
    } finally {
      if (coordinatedRefresh && live.current && boundary.get() === owner) setRefreshing(false);
    }
  };
  const execute = async (command: Command) => {
    if (pending.current) return false;
    pending.current = true;
    let confirmed = false;
    setBusy(true);
    setError(null);
    try {
      guard();
      setRetry(command);
      const { data } = await acceptMemberInvitation(
        api,
        { code: command.code, userAccount: command.userAccount, confirmation: true },
        config(),
      );
      guard();
      if (data.userAccount !== owner!.ownerAccountUuid || !data.current || !data.member || !data.company)
        throw new Error('The accepted member association could not be confirmed. Retry the same invitation.');
      setRetry(null);
      confirmed = true;
      await refresh();
    } catch (failure) {
      const status = failureStatus(failure);
      if (status && status < 500) setRetry(null);
      if (live.current && boundary.get() === owner)
        setError(
          failureSentence(failure, 'The outcome could not be confirmed. Refresh or retry the original request.'),
        );
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
    return confirmed;
  };
  const available =
    !!owner &&
    client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status === 'success' &&
    client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.fetchStatus === 'idle';
  const listReady = available && list.isSuccess && list.fetchStatus === 'idle';
  const ready =
    listReady &&
    !refreshing &&
    detail.isSuccess &&
    detail.fetchStatus === 'idle' &&
    list.data.some((row) => row.uuid === selected) &&
    !entries.isError;
  const readFailed = [list, detail, entries].some((read) => read.isError);
  return {
    scopeOwner: owner,
    owner: available ? owner : null,
    selectedUuid: selected,
    selectedToken: token,
    listReady,
    records: listReady ? list.data : [],
    record: ready ? detail.data : null,
    entriesReady: ready && entries.isSuccess && entries.fetchStatus === 'idle',
    entries: ready && entries.isSuccess && entries.fetchStatus === 'idle' ? entries.data : [],
    busy,
    refreshing,
    retry,
    loading: list.isPending,
    readFailed,
    failure: error,
    error: error ?? (readFailed ? 'Your current member records could not be read. Refresh before continuing.' : null),
    refresh: () => {
      if (live.current && boundary.get() === owner) setError(null);
      return refresh().catch((failure) => {
        if (live.current && boundary.get() === owner)
          setError(failureSentence(failure, 'The member records could not be refreshed.'));
      });
    },
    select: (uuid: string) => {
      if (!retry && !busy) {
        setSelected(uuid);
        setToken('');
        setError(null);
      }
    },
    selectToken: (uuid: string) => {
      if (!retry && !busy) setToken(uuid);
    },
    accept: (code: string) => owner && execute({ code, userAccount: owner.ownerAccountUuid, confirmation: true }),
    recover: () => retry && execute(retry),
  };
}

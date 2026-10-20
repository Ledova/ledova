import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  acceptMemberInvitation,
  createMemberCertificateRequest,
  createMemberParticularsRequest,
  getMemberCertificateRequests,
  getMemberParticularsRequests,
  getOwnMemberEntries,
  getOwnMemberRecord,
  getOwnMemberRecords,
  withdrawMemberCertificateRequest,
} from '../services/member-access';
import type { OwnMemberRecord, MemberCertificateRequest } from '../types';
import { failureStatus, failureSentence } from '../utils/errors';
import { readEveryPage } from '../utils/pagination';
import { useSubmissionOwner } from './useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY } from './useUserPreferences';
import type { OrderSubmissionSession } from './useOrderSubmissions';
import { useApiClient } from './useApiClient';

type Command =
  | { kind: 'accept'; code: string; userAccount: string; confirmation: true }
  | {
      kind: 'particulars';
      operationId: string;
      association: string;
      name: string;
      residentialAddress: string;
      confirmation: true;
    }
  | { kind: 'certificate'; operationId: string; association: string; token: string; entry: string }
  | { kind: 'withdraw'; uuid: string; idempotencyKey: string };

export function useMemberRecords(newKey: () => string, session?: OrderSubmissionSession) {
  const api = useApiClient();
  const client = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(session);
  const [selected, setSelected] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<Command | null>(null);
  const pending = useRef(false);
  const live = useRef(true);
  const current = useRef({ selected, token, owner });
  current.current = { selected, token, owner };
  const key = ['member-records', owner?.userUuid, owner?.ownerAccountUuid, session?.getEpoch() ?? 0];
  const detailKey = [...key, selected];
  const requestsKey = [...detailKey, 'requests'];
  const entriesKey = [...detailKey, 'entries', token];
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    setSelected('');
    setToken('');
    setRetry(null);
    setError(null);
  }, [owner]);
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
  const list = useQuery({
    queryKey: key,
    enabled: !!owner,
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
    queryKey: detailKey,
    enabled: !!selected && list.isSuccess && !list.isFetching,
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
  const requests = useQuery({
    queryKey: requestsKey,
    enabled: !!selected && detail.isSuccess && !detail.isFetching && list.isSuccess && !list.isFetching,
    queryFn: async () => {
      const [particulars, certificates] = await Promise.all([
        readEveryPage(async (page) => {
          guardRecord();
          const response = await getMemberParticularsRequests(
            api,
            { association: selected, page },
            config(guardRecord),
          );
          guardRecord();
          return response;
        }),
        readEveryPage(async (page) => {
          guardRecord();
          const response = await getMemberCertificateRequests(
            api,
            { association: selected, page },
            config(guardRecord),
          );
          guardRecord();
          return response;
        }),
      ]);
      const record = client.getQueryData<OwnMemberRecord>(detailKey)!;
      if (
        [...particulars, ...certificates].some(
          (row) => row.association !== selected || row.company !== record.company.uuid || row.member !== record.member,
        )
      )
        throw new Error('The requests do not belong to your selected member record.');
      return { particulars, certificates };
    },
  });
  const entries = useQuery({
    queryKey: entriesKey,
    enabled: !!token && !!selected && detail.isSuccess && !detail.isFetching && list.isSuccess && !list.isFetching,
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
  const guardAction = () => {
    guardRecord();
    const requestsState = client.getQueryState(requestsKey);
    const entriesState = client.getQueryState(entriesKey);
    if (requestsState?.status !== 'success' || requestsState.fetchStatus !== 'idle' || entriesState?.status === 'error')
      throw new Error('Refresh your current member requests before continuing.');
  };
  const refresh = async () => {
    guard();
    await list.refetch({ throwOnError: true });
    if (selected) {
      guardSelection();
      await detail.refetch({ throwOnError: true });
      await Promise.all([
        requests.refetch({ throwOnError: true }),
        ...(token ? [entries.refetch({ throwOnError: true })] : []),
      ]);
    }
  };
  const execute = async (command: Command) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const check = () => {
        if (command.kind === 'accept') guard();
        else guardAction();
        if (command.kind === 'certificate' && current.current.token !== command.token)
          throw new Error('The certificate request share class changed.');
      };
      check();
      if (command.kind !== 'accept' && command.kind !== 'withdraw' && command.association !== selected)
        throw new Error('The request belongs to a different association.');
      if (command.kind === 'certificate') {
        const state = client.getQueryState(entriesKey);
        const entry = client
          .getQueryData<{ uuid: string; kind: string; delta: string }[]>(entriesKey)
          ?.find((row) => row.uuid === command.entry);
        if (
          state?.status !== 'success' ||
          state.fetchStatus !== 'idle' ||
          !entry ||
          !['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase()) ||
          BigInt(entry.delta) <= 0n
        )
          throw new Error('Select a genuine positive own issue or transfer entry.');
      }
      if (command.kind === 'withdraw') {
        const state = client.getQueryState(requestsKey);
        const request = client
          .getQueryData<{ certificates: { uuid: string; status: string }[] }>(requestsKey)
          ?.certificates.find((row) => row.uuid === command.uuid);
        if (state?.status !== 'success' || state.fetchStatus !== 'idle' || !request)
          throw new Error('Refresh your own certificate request before withdrawing it.');
      }
      const record = client.getQueryData<OwnMemberRecord>(detailKey);
      setRetry(command);
      if (command.kind === 'accept') {
        const { data } = await acceptMemberInvitation(
          api,
          { code: command.code, userAccount: command.userAccount, confirmation: true },
          config(check),
        );
        check();
        if (data.userAccount !== owner!.ownerAccountUuid || !data.current || !data.member || !data.company)
          throw new Error('The accepted member association could not be confirmed. Retry the same invitation.');
      } else if (command.kind === 'particulars') {
        const { data } = await createMemberParticularsRequest(
          api,
          {
            operationId: command.operationId,
            association: command.association,
            name: command.name,
            residentialAddress: command.residentialAddress,
            confirmation: true,
          },
          config(check),
        );
        check();
        if (
          data.uuid !== command.operationId ||
          data.association !== selected ||
          data.company !== record?.company.uuid ||
          data.member !== record.member ||
          data.name !== command.name ||
          data.residentialAddress !== command.residentialAddress
        )
          throw new Error('The particulars request could not be confirmed. Retry the unchanged request.');
      } else if (command.kind === 'certificate') {
        const { data } = await createMemberCertificateRequest(
          api,
          { operationId: command.operationId, association: command.association, entry: command.entry },
          config(check),
        );
        check();
        if (
          data.uuid !== command.operationId ||
          data.association !== selected ||
          data.company !== record?.company.uuid ||
          data.member !== record.member ||
          data.token !== command.token ||
          data.entry !== command.entry
        )
          throw new Error('The certificate request could not be confirmed. Retry the unchanged request.');
      } else {
        const { data } = await withdrawMemberCertificateRequest(
          api,
          command.uuid,
          { idempotencyKey: command.idempotencyKey },
          config(check),
        );
        check();
        if (data.uuid !== command.uuid || data.association !== selected || data.status !== 'withdrawn')
          throw new Error('The withdrawal could not be confirmed. Retry the unchanged request.');
      }
      setRetry(null);
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
  };
  const available =
    !!owner &&
    client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status === 'success' &&
    client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.fetchStatus === 'idle';
  const listReady = available && list.isSuccess && list.fetchStatus === 'idle';
  const ready =
    listReady &&
    detail.isSuccess &&
    detail.fetchStatus === 'idle' &&
    list.data.some((row) => row.uuid === selected) &&
    !requests.isError &&
    !entries.isError;
  return {
    owner: available ? owner : null,
    records: listReady ? list.data : [],
    record: ready ? detail.data : null,
    entries: ready && entries.isSuccess && entries.fetchStatus === 'idle' ? entries.data : [],
    requests: ready && requests.isSuccess && requests.fetchStatus === 'idle' ? requests.data : null,
    guardCertificate: (uuid: string) => {
      guardAction();
      const request = client
        .getQueryData<{ certificates: MemberCertificateRequest[] }>(requestsKey)
        ?.certificates.find((row) => row.uuid === uuid);
      if (
        !request ||
        request.status !== 'fulfilled' ||
        !request.fulfilment ||
        request.association !== selected ||
        !/^[a-f0-9]{64}$/.test(request.fulfilment.digest) ||
        !Number.isSafeInteger(request.fulfilment.fileSize) ||
        request.fulfilment.fileSize < 1
      )
        throw new Error('Refresh your current certificate fulfilment before downloading it.');
      return request.fulfilment;
    },
    busy,
    retry,
    loading: list.isPending,
    error:
      error ??
      ([list, detail, requests, entries].some((read) => read.isError)
        ? 'Your current member records could not be read. Refresh before continuing.'
        : null),
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
    accept: (code: string) =>
      owner && execute({ kind: 'accept', code, userAccount: owner.ownerAccountUuid, confirmation: true }),
    requestParticulars: (name: string, residentialAddress: string) =>
      execute({
        kind: 'particulars',
        operationId: newKey(),
        association: selected,
        name,
        residentialAddress,
        confirmation: true,
      }),
    requestCertificate: (entry: string) =>
      execute({ kind: 'certificate', operationId: newKey(), association: selected, token, entry }),
    withdraw: (uuid: string) => execute({ kind: 'withdraw', uuid, idempotencyKey: newKey() }),
    recover: () => retry && execute(retry),
  };
}

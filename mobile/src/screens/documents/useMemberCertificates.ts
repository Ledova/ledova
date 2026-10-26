import { useCallback } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  getMemberCertificateRequests,
  getOwnMemberEntries,
  ownMemberRecordsKey,
  readEveryPage,
  type MemberCertificateRequest,
  type useMemberRecords,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';

type Read = ReturnType<typeof useMemberRecords>;
type MemberRecord = Read['records'][number];
type Entry = Read['entries'][number];

export interface MemberCertificate {
  record: MemberRecord;
  request: MemberCertificateRequest;
  className?: string;
  entry?: Entry;
}

const listed = (request: MemberCertificateRequest) =>
  request.status === 'requested' || (request.status === 'fulfilled' && !!request.fulfilment);

export function useMemberCertificates(read: Read) {
  const client = useQueryClient();
  const [scope, profile, account, epoch] = ownMemberRecordsKey(read.owner, orderSubmissionSession.getEpoch());
  const key = [scope, profile, account, epoch, 'documents'] as const;
  const lists = useQueries({
    queries: read.records.map((record) => ({
      queryKey: [...key, record.uuid],
      enabled: !!read.owner,
      queryFn: async () => {
        const rows = await readEveryPage((page) =>
          getMemberCertificateRequests(
            apiClient,
            { association: record.uuid, page },
            orderSubmissionSession.requestConfig(),
          ),
        );
        if (
          rows.some(
            (row) =>
              row.association !== record.uuid || row.company !== record.company.uuid || row.member !== record.member,
          )
        )
          throw new Error('The certificates do not belong to your member record.');
        return rows;
      },
    })),
  });
  const found = read.records.flatMap((record, index) =>
    (lists[index]?.data ?? []).filter(listed).map((request) => ({ record, request })),
  );
  const classes = [
    ...new Map(
      found
        .filter(({ record, request }) => record.classes.some((item) => item.uuid === request.token))
        .map(({ record, request }) => [`${record.uuid}/${request.token}`, { record, token: request.token }]),
    ).values(),
  ];
  const entries = useQueries({
    queries: classes.map(({ record, token }) => ({
      queryKey: [...key, record.uuid, token],
      enabled: !!read.owner,
      queryFn: async () => {
        const { data } = await getOwnMemberEntries(
          apiClient,
          record.uuid,
          token,
          orderSubmissionSession.requestConfig(),
        );
        if (!Array.isArray(data.entries) || data.entries.some((row) => !/^-?\d+$/.test(row.delta)))
          throw new Error('The own entry deltas could not be confirmed.');
        return data.entries;
      },
    })),
  });
  const entryOf = new Map(entries.flatMap((query) => (query.data ?? []).map((entry) => [entry.uuid, entry] as const)));
  const certificates: MemberCertificate[] = found
    .map(({ record, request }) => ({
      record,
      request,
      className: record.classes.find((item) => item.uuid === request.token)?.name,
      entry: entryOf.get(request.entry),
    }))
    .sort(
      (a, b) =>
        a.record.company.name.localeCompare(b.record.company.name) ||
        b.request.createdAt.localeCompare(a.request.createdAt),
    );
  return {
    certificates,
    loading: lists.some((query) => query.isPending),
    failed: lists.some((query) => query.isError),
    refetch: useCallback(
      () => client.refetchQueries({ queryKey: [scope, profile, account, epoch, 'documents'] }),
      [client, scope, profile, account, epoch],
    ),
  };
}

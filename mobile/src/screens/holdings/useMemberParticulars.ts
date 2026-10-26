import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  getMemberParticularsRequests,
  ownMemberRecordsKey,
  readEveryPage,
  type MemberParticularsRequest,
  type useMemberRecords,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';

type Read = ReturnType<typeof useMemberRecords>;

const waiting = (request: MemberParticularsRequest) =>
  request.status === 'submitted' || request.status === 'prepared' || request.status === 'approved';

export function useMemberParticulars(read: Read) {
  const client = useQueryClient();
  const [scope, profile, account, epoch] = ownMemberRecordsKey(read.owner, orderSubmissionSession.getEpoch());
  const lists = useQueries({
    queries: read.records.map((record) => ({
      queryKey: [scope, profile, account, epoch, 'particulars', record.uuid],
      enabled: !!read.owner,
      queryFn: async () => {
        const rows = await readEveryPage((page) =>
          getMemberParticularsRequests(
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
          throw new Error('The particulars requests do not belong to your member record.');
        return rows;
      },
    })),
  });
  const waitingAt = (uuid: string) => {
    const query = lists[read.records.findIndex((record) => record.uuid === uuid)];
    return query && !query.isError ? (query.data ?? []).filter(waiting) : [];
  };
  const refetch = useCallback(
    () => client.refetchQueries({ queryKey: [scope, profile, account, epoch, 'particulars'] }),
    [client, scope, profile, account, epoch],
  );
  const seen = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (seen.current) void refetch();
      seen.current = true;
    }, [refetch]),
  );
  return {
    waitingAt,
    waitingCount: read.records.reduce((sum, record) => sum + waitingAt(record.uuid).length, 0),
    loading: lists.some((query) => query.isPending),
    failed: lists.some((query) => query.isError),
    refetch,
  };
}

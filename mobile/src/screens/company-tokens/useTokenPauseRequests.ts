import { useQueries } from '@tanstack/react-query';
import {
  getPauseSubmission,
  type CompanyShareToken,
  type PauseSubmissionResponse,
  type SavedPause,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';

export function pauseSubmissionKey(record: SavedPause, epoch: number) {
  return ['pause-submission', record.userUuid, record.ownerAccountUuid, record.tokenUuid, record.submissionId, epoch];
}

export function checked(record: SavedPause, response: PauseSubmissionResponse) {
  if (
    response.submission.uuid !== record.submissionId ||
    response.submission.paused !== record.paused ||
    response.token.uuid !== record.tokenUuid
  )
    throw new Error('The server returned a different pause submission. The original request remains saved.');
  return response;
}

export function useTokenPauseRequests({
  records,
  token,
  epoch,
  guard,
  refreshClass,
}: {
  records: SavedPause[];
  token: Pick<CompanyShareToken, 'uuid' | 'status'>;
  epoch: number;
  guard: () => void;
  refreshClass: () => void;
}) {
  return useQueries({
    queries: records.map((record) => ({
      queryKey: pauseSubmissionKey(record, epoch),
      queryFn: async () => {
        guard();
        const response = await getPauseSubmission(apiClient, token.uuid, record.submissionId, {
          ledovaSubmissionGuard: guard,
          ledovaSessionEpoch: epoch,
        });
        guard();
        const result = checked(record, response.data);
        refreshClass();
        return result;
      },
      retry: false,
      refetchInterval: (query: { state: { data?: PauseSubmissionResponse } }) =>
        query.state.data?.submission.completedAt ? (false as const) : 5000,
    })),
  });
}

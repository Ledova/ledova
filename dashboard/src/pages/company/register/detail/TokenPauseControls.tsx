import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  getErrorMessage,
  getPauseSubmission,
  pauseCompanyToken,
  unpauseCompanyToken,
  useSubmissionOwner,
  type CompanyShareToken,
  type OrderSubmissionOwner,
  type PauseSubmissionResponse,
  type SavedPause,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { PageAction } from '@components/Page';
import { pauseSubmissionStore } from '@services/pauseSubmissions';

const queryKey = (record: SavedPause) => [
  'pause-submission',
  record.userUuid,
  record.ownerAccountUuid,
  record.tokenUuid,
  record.submissionId,
];

function checked(record: SavedPause, response: PauseSubmissionResponse) {
  if (
    response.submission.uuid !== record.submissionId ||
    response.submission.paused !== record.paused ||
    response.token.uuid !== record.tokenUuid
  )
    throw new Error('The server returned a different pause submission. The original request remains saved.');
  return response;
}

function readSavedPauses(guard: () => void, owner: OrderSubmissionOwner, tokenUuid: string) {
  try {
    guard();
    return { saved: pauseSubmissionStore.list(owner, tokenUuid), error: null };
  } catch (failure) {
    return { saved: null, error: getErrorMessage(failure, 'Saved pause requests could not be read.') };
  }
}

function PauseRequests({
  token,
  owner,
  currentOwner,
}: {
  token: Pick<CompanyShareToken, 'uuid' | 'status'>;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const queryClient = useQueryClient();
  const guard = useCallback(() => {
    if (currentOwner() !== owner) throw new Error('The issuer session changed. Reopen the token to continue.');
  }, [currentOwner, owner]);
  const [initial] = useState(() => readSavedPauses(guard, owner, token.uuid));
  const [records, setRecords] = useState<SavedPause[]>(initial.saved ?? []);
  const [error, setError] = useState<string | null>(initial.error);
  const [ready, setReady] = useState(initial.saved !== null);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const load = useCallback(() => {
    const { saved, error: failure } = readSavedPauses(guard, owner, token.uuid);
    if (saved) {
      setRecords((previous) => [
        ...previous,
        ...saved.filter((record) => !previous.some((existing) => existing.submissionId === record.submissionId)),
      ]);
      setReady(true);
    } else {
      setReady(false);
      setError(failure);
    }
  }, [guard, owner, token.uuid]);
  useEffect(() => {
    window.addEventListener('storage', load);
    return () => window.removeEventListener('storage', load);
  }, [load]);
  const queries = useQueries({
    queries: records.map((record) => ({
      queryKey: queryKey(record),
      queryFn: async () => {
        guard();
        const response = await getPauseSubmission(apiClient, token.uuid, record.submissionId, {
          ledovaSubmissionGuard: guard,
        });
        guard();
        const result = checked(record, response.data);
        void queryClient.invalidateQueries({ queryKey: ['token', token.uuid] });
        void queryClient.invalidateQueries({ queryKey: ['tokens'] });
        return result;
      },
      retry: false,
      refetchInterval: (query: { state: { data?: PauseSubmissionResponse } }) =>
        query.state.data?.submission.completedAt ? (false as const) : 5000,
    })),
  });
  const send = async (previous: SavedPause) => {
    const paused = previous.paused;
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      guard();
      const record = pauseSubmissionStore.retain(previous);
      load();
      guard();
      const response = await (paused ? pauseCompanyToken : unpauseCompanyToken)(
        apiClient,
        token.uuid,
        { submissionId: record.submissionId },
        { ledovaSubmissionGuard: guard },
      );
      guard();
      queryClient.setQueryData(queryKey(record), checked(record, response.data));
      void queryClient.invalidateQueries({ queryKey: ['token', token.uuid] });
    } catch (failure) {
      if (currentOwner() === owner) {
        setError(getErrorMessage(failure, 'The pause response is unresolved. Check or retry the saved request.'));
        load();
      }
    } finally {
      inFlight.current = false;
      if (currentOwner() === owner) setSending(false);
    }
  };
  const dismiss = (record: SavedPause) => {
    try {
      guard();
      pauseSubmissionStore.remove(record);
      setRecords((previous) => previous.filter((existing) => existing.submissionId !== record.submissionId));
      load();
    } catch (failure) {
      setError(getErrorMessage(failure, 'The completed reminder could not be cleared.'));
    }
  };
  return (
    <div className="w-full space-y-3 text-sm text-text-primary">
      <p className="text-text-muted">Retained issuer requests. Prepare new pause decisions in the company panel.</p>
      {!ready && !error && <p>Loading saved pause requests…</p>}
      {error && (
        <div role="alert" className="space-y-2">
          <p className="text-error-light">{error}</p>
          <PageAction label="Reload saved requests" onClick={load} />
        </div>
      )}
      {records.length > 0 && (
        <div className="divide-y divide-border-subtle border-y border-border-subtle">
          {records.map((record, index) => {
            const query = queries[index];
            const response = query.data;
            return (
              <div
                key={record.submissionId}
                role="group"
                aria-label={`${record.paused ? 'Pause' : 'Unpause'} request ${record.submissionId}`}
                className="space-y-2 py-3"
              >
                <p className="break-words text-xs text-text-muted">
                  {record.paused ? 'Pause' : 'Unpause'} request {record.submissionId}
                </p>
                <p role="status">
                  {response?.message ?? 'Outcome unresolved. This request remains saved on this device.'}
                </p>
                {query.error && (
                  <p role="alert" className="text-error-light">
                    {getErrorMessage(query.error, 'The request outcome could not be checked.')}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {response?.submission.completedAt ? (
                    <PageAction label="Dismiss outcome" onClick={() => dismiss(record)} />
                  ) : (
                    <>
                      <PageAction
                        label="Check outcome"
                        disabled={query.isFetching}
                        onClick={() => void query.refetch()}
                      />
                      <PageAction label="Retry same request" disabled={sending} onClick={() => void send(record)} />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function TokenPauseControls({ token }: { token: Pick<CompanyShareToken, 'uuid' | 'status'> }) {
  const { owner, boundary } = useSubmissionOwner();
  if (!owner)
    return (
      <p className="text-sm text-text-primary">Verify your issuer session before reading retained pause requests.</p>
    );
  return (
    <PauseRequests
      key={`${owner.userUuid}/${owner.ownerAccountUuid}/${token.uuid}`}
      token={token}
      owner={owner}
      currentOwner={boundary.get}
    />
  );
}

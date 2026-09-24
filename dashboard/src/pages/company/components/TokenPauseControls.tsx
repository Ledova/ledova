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
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import {
  listSavedPauses,
  removeSavedPause,
  retainSavedPause,
  savePause,
  type SavedPause,
} from '@services/pauseSubmissions';

const queryKey = (record: SavedPause) => [
  'pause-submission',
  record.userUuid,
  record.ownerAccountUuid,
  record.tokenUuid,
  record.submissionId,
];

const reminderButtonClassName =
  'mt-3 mr-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-primary hover:bg-surface-tertiary disabled:opacity-50';

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
    return { saved: listSavedPauses(owner, tokenUuid), error: null };
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
  const blocked = !ready || sending || queries.some((query) => !query.data?.submission.completedAt);
  const send = async (paused: boolean, previous?: SavedPause) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      guard();
      const record = previous ? retainSavedPause(previous) : savePause(owner, token.uuid, paused);
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
      removeSavedPause(record);
      setRecords((previous) => previous.filter((existing) => existing.submissionId !== record.submissionId));
      load();
    } catch (failure) {
      setError(getErrorMessage(failure, 'The completed reminder could not be cleared.'));
    }
  };
  return (
    <div className="w-full space-y-2 text-text-primary">
      <button
        type="button"
        disabled={blocked}
        onClick={() => void send(token.status !== 'paused')}
        className="rounded-lg border border-border px-4 py-2.5 text-sm disabled:opacity-50"
      >
        {sending ? 'Saving request...' : token.status === 'paused' ? 'Unpause' : 'Pause'}
      </button>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button type="button" className={reminderButtonClassName} onClick={load}>
            Reload saved requests
          </button>
        </div>
      )}
      {records.map((record, index) => {
        const query = queries[index];
        const response = query.data;
        return (
          <div
            key={record.submissionId}
            role="group"
            aria-label={`${record.paused ? 'Pause' : 'Unpause'} request ${record.submissionId}`}
            className="rounded-lg border border-border p-3 text-sm"
          >
            <p className="break-words text-xs text-text-muted">
              {record.paused ? 'Pause' : 'Unpause'} request {record.submissionId}
            </p>
            <p role="status" className="mt-2">
              {response?.message ?? 'Outcome unresolved. This request remains saved on this device.'}
            </p>
            {query.error && (
              <p role="alert">{getErrorMessage(query.error, 'The request outcome could not be checked.')}</p>
            )}
            {response?.submission.completedAt ? (
              <button type="button" className={reminderButtonClassName} onClick={() => dismiss(record)}>
                Dismiss outcome
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={reminderButtonClassName}
                  disabled={query.isFetching}
                  onClick={() => void query.refetch()}
                >
                  Check outcome
                </button>
                <button
                  type="button"
                  className={reminderButtonClassName}
                  disabled={sending}
                  onClick={() => void send(record.paused, record)}
                >
                  Retry same request
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TokenPauseControls({ token }: { token: Pick<CompanyShareToken, 'uuid' | 'status'> }) {
  const { owner, boundary } = useSubmissionOwner();
  if (!owner)
    return <p className="text-text-primary">Verify your issuer session before requesting a pause or unpause.</p>;
  return (
    <PauseRequests
      key={`${owner.userUuid}/${owner.ownerAccountUuid}/${token.uuid}`}
      token={token}
      owner={owner}
      currentOwner={boundary.get}
    />
  );
}

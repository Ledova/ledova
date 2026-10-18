import { PageAction } from '@components/Page';
import { getErrorMessage, useSubmissionOwner, type CompanyShareToken, type OrderSubmissionOwner } from '@ledova/shared';
import { useTokenPauseRequests } from './useTokenPauseControls';

function PauseRequests({
  token,
  owner,
  currentOwner,
}: {
  token: Pick<CompanyShareToken, 'uuid' | 'status'>;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const { records, error, ready, sending, load, queries, send, dismiss } = useTokenPauseRequests({
    token,
    owner,
    currentOwner,
  });
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

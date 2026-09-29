import { useState } from 'react';
import {
  BALLOT_CHOICES,
  PUBLICATION_COPY,
  RESOLUTION_KIND_LABELS,
  describeCount,
  describeTurnout,
  formatDateTime,
  useResolutionStatus,
} from '@ledova/shared';
import type { BallotChoice, Publication, PublicationResult, ResolutionStatus } from '@ledova/shared';
import { Row, Rows, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';

function statusLabel(status: ResolutionStatus, closesAt: string | null) {
  if (status === 'upcoming') return PUBLICATION_COPY.NOT_OPEN_YET;
  if (status === 'open') return `${PUBLICATION_COPY.OPEN_UNTIL} ${formatDateTime(closesAt)}`;
  return PUBLICATION_COPY.CLOSED;
}

function Result({ result }: { result: PublicationResult }) {
  return (
    <div className="mt-3">
      <p className="text-xs uppercase tracking-wide text-text-muted">{PUBLICATION_COPY.RESULT_LABEL}</p>
      <p className="mt-1 text-sm text-text-primary">
        <Status tone={result.carried ? 'done' : 'closed'}>
          {result.carried ? PUBLICATION_COPY.CARRIED : PUBLICATION_COPY.NOT_CARRIED}
        </Status>
      </p>
      <Rows>
        {BALLOT_CHOICES.map((choice) => (
          <Row key={choice} label={PUBLICATION_COPY.CHOICES[choice]}>
            {describeCount(result[choice])}
          </Row>
        ))}
        <Row label={PUBLICATION_COPY.TURNOUT_LABEL}>{describeTurnout(result)}</Row>
      </Rows>
    </div>
  );
}

export function Resolution({
  publication,
  onCast,
  isCasting,
  castError,
}: {
  publication: Publication;
  onCast: (uuid: string, choice: BallotChoice) => void;
  isCasting: boolean;
  castError: string | undefined;
}) {
  const [choosing, setChoosing] = useState<BallotChoice | null>(null);
  const status = useResolutionStatus(publication);
  if (status === null) return null;
  const mayVote = status === 'open' && publication.ballotOutstanding;

  return (
    <div className="py-3">
      <p className="text-xs uppercase tracking-wide text-text-muted">{PUBLICATION_COPY.QUESTION_LABEL}</p>
      <p className="text-sm text-text-primary mt-0.5 whitespace-pre-line">{publication.question}</p>
      <p className="text-xs text-text-muted mt-2">
        {publication.resolutionKind ? `${RESOLUTION_KIND_LABELS[publication.resolutionKind]} · ` : ''}
        {PUBLICATION_COPY.BASIS}
      </p>
      <p className="text-xs text-text-muted mt-0.5">
        {PUBLICATION_COPY.WINDOW_LABEL} {formatDateTime(publication.opensAt)} {PUBLICATION_COPY.WINDOW_TO}{' '}
        {formatDateTime(publication.closesAt)}
      </p>
      <p className="text-xs font-semibold text-text-secondary mt-1">{statusLabel(status, publication.closesAt)}</p>

      {publication.myBallot && (
        <div className="mt-3">
          <p className="text-sm font-semibold text-text-primary">
            {PUBLICATION_COPY.YOU_VOTED[publication.myBallot.choice]}
          </p>
          {publication.myBallot.staffEntered && (
            <p className="text-xs text-text-muted mt-0.5">{PUBLICATION_COPY.STAFF_ENTERED}</p>
          )}
          {mayVote && <p className="text-xs text-text-muted mt-0.5">{PUBLICATION_COPY.BALLOT_OUTSTANDING}</p>}
        </div>
      )}

      {mayVote && choosing === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          {BALLOT_CHOICES.map((choice) => (
            <PageAction key={choice} onClick={() => setChoosing(choice)} label={PUBLICATION_COPY.CHOICES[choice]} />
          ))}
        </div>
      )}

      {mayVote && choosing !== null && (
        <div className="mt-3 border-t border-border-subtle pt-3">
          <p className="text-sm font-semibold text-text-primary">
            {PUBLICATION_COPY.CONFIRM_TITLE} {PUBLICATION_COPY.CHOICES[choosing]}
          </p>
          <p className="text-xs text-text-muted mt-0.5">{PUBLICATION_COPY.CONFIRM_BODY}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <PageAction
              onClick={() => onCast(publication.uuid, choosing)}
              disabled={isCasting}
              primary
              label={isCasting ? PUBLICATION_COPY.CASTING : PUBLICATION_COPY.CONFIRM}
            />
            <PageAction onClick={() => setChoosing(null)} disabled={isCasting} label={PUBLICATION_COPY.CANCEL} />
          </div>
        </div>
      )}

      {castError && (
        <p role="alert" className="mt-3 text-sm text-error-light">
          {castError}
        </p>
      )}

      {status === 'closed' &&
        (publication.result ? (
          <Result result={publication.result} />
        ) : (
          <p className="text-xs text-text-muted mt-3">{PUBLICATION_COPY.RESULT_PENDING}</p>
        ))}
    </div>
  );
}

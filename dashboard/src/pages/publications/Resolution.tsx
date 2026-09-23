import { useState } from 'react';
import {
  BALLOT_CHOICES,
  PUBLICATION_COPY,
  RESOLUTION_KIND_LABELS,
  describeCount,
  describeTurnout,
  formatDateTime,
  resolutionStatus,
} from '@ledova/shared';
import type { BallotChoice, Publication, PublicationResult, ResolutionStatus } from '@ledova/shared';

function statusLabel(status: ResolutionStatus, closesAt: string | null) {
  if (status === 'upcoming') return PUBLICATION_COPY.NOT_OPEN_YET;
  if (status === 'open') return `${PUBLICATION_COPY.OPEN_UNTIL} ${formatDateTime(closesAt)}`;
  return PUBLICATION_COPY.CLOSED;
}

function Result({ result }: { result: PublicationResult }) {
  return (
    <div className="mt-3">
      <p className="text-xs uppercase tracking-wide text-text-muted">{PUBLICATION_COPY.RESULT_LABEL}</p>
      <p className={`text-sm font-semibold mt-0.5 ${result.carried ? 'text-success-light' : 'text-error-light'}`}>
        {result.carried ? PUBLICATION_COPY.CARRIED : PUBLICATION_COPY.NOT_CARRIED}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        {BALLOT_CHOICES.map((choice) => (
          <div key={choice} className="contents">
            <dt className="text-text-muted">{PUBLICATION_COPY.CHOICES[choice]}</dt>
            <dd className="text-text-primary font-mono">{describeCount(result[choice])}</dd>
          </div>
        ))}
        <dt className="text-text-muted">{PUBLICATION_COPY.TURNOUT_LABEL}</dt>
        <dd className="text-text-primary font-mono">{describeTurnout(result)}</dd>
      </dl>
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
  const status = resolutionStatus(publication, new Date());
  if (status === null) return null;
  const onTheRoll = publication.shares !== null && publication.shares !== undefined;
  const mayVote = status === 'open' && onTheRoll && !publication.myBallot;

  return (
    <div className="mt-3 rounded-lg bg-surface-tertiary/30 px-3 py-3">
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
        </div>
      )}

      {mayVote && choosing === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          {BALLOT_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => setChoosing(choice)}
              className="rounded-lg border border-brand-mid px-4 py-2 text-sm font-semibold text-text-primary hover:bg-brand-mid/10 transition-colors"
            >
              {PUBLICATION_COPY.CHOICES[choice]}
            </button>
          ))}
        </div>
      )}

      {mayVote && choosing !== null && (
        <div className="mt-3 rounded-lg border border-warning-light/30 bg-warning-light/10 px-3 py-3">
          <p className="text-sm font-semibold text-text-primary">
            {PUBLICATION_COPY.CONFIRM_TITLE} {PUBLICATION_COPY.CHOICES[choosing]}
          </p>
          <p className="text-xs text-text-muted mt-0.5">{PUBLICATION_COPY.CONFIRM_BODY}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onCast(publication.uuid, choosing)}
              disabled={isCasting}
              className="rounded-lg bg-brand-mid hover:bg-brand disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white transition-colors"
            >
              {isCasting ? PUBLICATION_COPY.CASTING : PUBLICATION_COPY.CONFIRM}
            </button>
            <button
              type="button"
              onClick={() => setChoosing(null)}
              disabled={isCasting}
              className="rounded-lg px-4 py-2 text-sm text-text-muted hover:text-text-primary disabled:opacity-50 transition-colors"
            >
              {PUBLICATION_COPY.CANCEL}
            </button>
          </div>
        </div>
      )}

      {castError && (
        <div role="alert" className="mt-3 rounded-lg bg-error/10 px-3 py-2 text-sm text-error">
          {castError}
        </div>
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

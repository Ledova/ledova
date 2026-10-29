import { RESOLUTION_RESULT_TONES } from '@components/statusTones';
import {
  BALLOT_CHOICES,
  PUBLICATION_COPY,
  PUBLICATION_KIND_LABELS,
  RESOLUTION_KIND_LABELS,
  describeCount,
  describeRate,
  describeTurnout,
  formatDate,
  formatDateTime,
  useResolutionStatus,
  type Publication,
} from '@ledova/shared';
import { Row, Rows, ShowMore, Status, type Tone } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';

const PUBLICATION_WINDOW_TONES = new Map<string, Tone>([
  ['open', 'moving'],
  ['upcoming', 'waiting'],
]);

function ResolutionRecord({
  publication,
  status,
}: {
  publication: Publication;
  status: ReturnType<typeof useResolutionStatus>;
}) {
  if (status === null) return null;
  return (
    <div className="space-y-3 py-2">
      <p className="whitespace-pre-wrap text-sm text-text-primary">{publication.question}</p>
      <p className="text-sm text-text-muted">
        {publication.resolutionKind && `${RESOLUTION_KIND_LABELS[publication.resolutionKind]} · `}
        {PUBLICATION_COPY.BASIS}
      </p>
      <Rows>
        <Row label="Voting opens">{formatDateTime(publication.opensAt)}</Row>
        <Row label="Voting closes">{formatDateTime(publication.closesAt)}</Row>
      </Rows>
      {publication.result ? (
        <>
          <p className="text-sm text-text-primary">
            <Status tone={RESOLUTION_RESULT_TONES.get(!!publication.result.carried)!}>
              {publication.result.carried ? PUBLICATION_COPY.CARRIED : PUBLICATION_COPY.NOT_CARRIED}
            </Status>
          </p>
          <Rows>
            {BALLOT_CHOICES.map((choice) => (
              <Row key={choice} label={PUBLICATION_COPY.CHOICES[choice]}>
                <span className="break-all">{describeCount(publication.result![choice])}</span>
              </Row>
            ))}
            <Row label="Eligible">
              <span className="break-all">{describeCount(publication.result.eligible)}</span>
            </Row>
            <Row label={PUBLICATION_COPY.TURNOUT_LABEL}>
              <span className="break-all">{describeTurnout(publication.result)}</span>
            </Row>
          </Rows>
        </>
      ) : (
        status === 'closed' && <p className="text-sm text-text-muted">{PUBLICATION_COPY.RESULT_PENDING}</p>
      )}
    </div>
  );
}

export function PublicationRecord({
  publication,
  open,
  opening,
  blocked,
}: {
  publication: Publication;
  open: () => void;
  opening: boolean;
  blocked: boolean;
}) {
  const status = useResolutionStatus(publication);
  return (
    <article className="min-w-0 space-y-3 break-words py-3">
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-medium text-text-primary">{publication.title}</h3>
          <p className="text-sm text-text-muted">
            {PUBLICATION_KIND_LABELS[publication.kind]} · {publication.tokenName} ({publication.tokenSymbol})
          </p>
        </div>
        <div className="space-y-1 text-sm text-text-muted sm:text-right">
          {status !== null && (
            <Status tone={PUBLICATION_WINDOW_TONES.get(status) ?? 'closed'}>
              {status === 'upcoming'
                ? PUBLICATION_COPY.NOT_OPEN_YET
                : status === 'open'
                  ? 'Voting is open'
                  : PUBLICATION_COPY.CLOSED}
            </Status>
          )}
          <p>Published {formatDate(publication.createdAt)}</p>
        </div>
      </div>
      <ShowMore show="Show details" hide="Hide details">
        <Rows>
          <Row label={PUBLICATION_COPY.RECORD_DATE_LABEL}>{formatDate(publication.recordDate)}</Row>
        </Rows>
        <ResolutionRecord publication={publication} status={status} />
        {publication.kind === 'distribution' && (
          <Rows>
            <Row label="Rate per share">
              <span className="break-all">{describeRate(publication)}</span>
            </Row>
            {publication.declaredOn && <Row label="Declared">{formatDate(publication.declaredOn)}</Row>}
            {publication.paymentDate && <Row label="Payment date">{formatDate(publication.paymentDate)}</Row>}
          </Rows>
        )}
      </ShowMore>
      <FormActions>
        <PageAction
          primary
          label={PUBLICATION_COPY.OPEN}
          busy={opening}
          busyLabel={PUBLICATION_COPY.OPENING}
          onClick={open}
          disabled={blocked}
        />
      </FormActions>
    </article>
  );
}

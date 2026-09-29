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
import { Row, Rows, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';

function ResolutionRecord({ publication }: { publication: Publication }) {
  const status = useResolutionStatus(publication);
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
      <p className="text-sm text-text-primary">
        <Status tone={status === 'open' ? 'moving' : status === 'upcoming' ? 'waiting' : 'closed'}>
          {status === 'upcoming'
            ? PUBLICATION_COPY.NOT_OPEN_YET
            : status === 'open'
              ? 'Voting is open'
              : PUBLICATION_COPY.CLOSED}
        </Status>
      </p>
      {publication.result ? (
        <>
          <p className="text-sm text-text-primary">
            <Status tone={publication.result.carried ? 'done' : 'closed'}>
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
  return (
    <article className="flex min-w-0 flex-col gap-2 break-words py-4">
      <h3 className="break-words text-sm font-medium text-text-primary">{publication.title}</h3>
      <p className="text-xs uppercase tracking-wide text-text-muted">{PUBLICATION_KIND_LABELS[publication.kind]}</p>
      <p className="text-sm text-text-primary">{publication.companyName}</p>
      <p className="text-sm text-text-muted">
        {publication.tokenName} ({publication.tokenSymbol})
      </p>
      <Rows>
        <Row label={PUBLICATION_COPY.RECORD_DATE_LABEL}>{formatDate(publication.recordDate)}</Row>
        <Row label="Published">{formatDate(publication.createdAt)}</Row>
      </Rows>
      <ResolutionRecord publication={publication} />
      {publication.kind === 'distribution' && (
        <Rows>
          <Row label="Rate per share">
            <span className="break-all">{describeRate(publication)}</span>
          </Row>
          {publication.declaredOn && <Row label="Declared">{formatDate(publication.declaredOn)}</Row>}
          {publication.paymentDate && <Row label="Payment date">{formatDate(publication.paymentDate)}</Row>}
        </Rows>
      )}
      <PageAction
        label={opening ? PUBLICATION_COPY.OPENING : PUBLICATION_COPY.OPEN}
        onClick={open}
        disabled={opening || blocked}
      />
    </article>
  );
}

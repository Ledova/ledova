import { Link } from 'react-router-dom';
import {
  DESTINATIONS,
  PUBLICATION_COPY,
  PUBLICATION_KIND_LABELS,
  formatDate,
  formatDateTime,
  useResolutionStatus,
  type Publication,
} from '@ledova/shared';
import { Section, Status, LoadError, Loading } from '@components/Ledger';
import { useHoldingWork } from './useHoldingWork';

const LINK = 'text-sm font-medium text-brand-light underline underline-offset-4';

function RecentNotice({ publication }: { publication: Publication }) {
  const open = useResolutionStatus(publication) === 'open';
  return (
    <li className="grid items-start gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0 flex-1 basis-48 break-words">
        <p className="text-sm text-text-muted">
          {publication.companyName} · {PUBLICATION_KIND_LABELS[publication.kind]}
        </p>
        <p className="text-base text-text-primary">{publication.title}</p>
        {open && publication.closesAt && (
          <p className="text-sm text-text-muted">
            {PUBLICATION_COPY.OPEN_UNTIL} {formatDateTime(publication.closesAt)}
          </p>
        )}
      </div>
      <time dateTime={publication.createdAt} className="text-sm tabular-nums text-text-muted">
        {formatDate(publication.createdAt)}
      </time>
    </li>
  );
}

export function HoldingWork() {
  const { notices, recent } = useHoldingWork();
  const summary = notices.isError ? undefined : notices.summary;
  const complete = summary !== undefined;
  const votes = summary?.openResolutions ?? 0;
  const dividends = summary?.dividendsWithoutRecord ?? 0;

  return (
    <>
      {notices.isPending ? (
        <Loading>Loading your notices…</Loading>
      ) : notices.isError ? (
        <LoadError retry={() => notices.retry()} busy={notices.isFetching}>
          Your notices could not be loaded.
        </LoadError>
      ) : null}

      <Section title="Needs you">
        {votes > 0 && (
          <div className="grid items-start gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <p className="text-sm text-text-primary">
              <Status tone="waiting">
                {votes} {votes === 1 ? 'resolution awaits' : 'resolutions await'} your vote
              </Status>
              {summary?.nextClosesAt && (
                <span className="block pt-1 text-text-muted">
                  {votes === 1 ? 'Closes' : 'First closes'} {formatDateTime(summary.nextClosesAt)}
                </span>
              )}
            </p>
            <Link to={DESTINATIONS.publications.path} className={LINK}>
              View notices to vote
            </Link>
          </div>
        )}
        {complete && votes === 0 && <p className="py-3 text-sm text-text-muted">No votes need your attention.</p>}
      </Section>

      <Section title="In progress">
        {dividends > 0 && (
          <div className="grid items-start gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <p className="text-sm text-text-primary">
              <Status tone="moving">
                {dividends} {dividends === 1 ? 'dividend awaits' : 'dividends await'} a payment record from the company
              </Status>
            </p>
            <Link to={DESTINATIONS.publications.path} className={LINK}>
              View dividend notices
            </Link>
          </div>
        )}
        {complete && dividends === 0 && (
          <p className="py-3 text-sm text-text-muted">No dividend records are in progress.</p>
        )}
      </Section>

      <Section title="Recently published to you">
        {recent.isPending ? (
          <Loading>Loading what has been published to you…</Loading>
        ) : recent.isError ? (
          <LoadError retry={() => recent.refetch()} busy={recent.isFetching}>
            What has been published to you could not be loaded.
          </LoadError>
        ) : recent.data.length === 0 ? (
          <p className="py-3 text-sm text-text-muted">{PUBLICATION_COPY.EMPTY}</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {recent.data.map((publication) => (
              <RecentNotice key={publication.uuid} publication={publication} />
            ))}
          </ul>
        )}
        <Link to={DESTINATIONS.publications.path} className={`${LINK} self-start`}>
          View all notices
        </Link>
      </Section>
    </>
  );
}

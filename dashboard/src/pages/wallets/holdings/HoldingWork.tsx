import { Link } from 'react-router-dom';
import {
  DESTINATIONS,
  PUBLICATION_COPY,
  PUBLICATION_KIND_LABELS,
  formatDate,
  formatDateTime,
  useResolutionStatus,
  type Publication,
  shareCount,
} from '@ledova/shared';
import { Section, Status, LoadError, Loading } from '@components/Ledger';
import { useHoldingWork } from './useHoldingWork';
import type { ApplicationWork } from './applicationWork';

const LINK = 'text-sm font-medium text-brand-light underline underline-offset-4';

function Applications({ rows }: { rows: ApplicationWork[] }) {
  return (
    <ul className="divide-y divide-border-subtle">
      {rows.map(({ application, description }) => (
        <li key={application.uuid} className="grid items-start gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 flex-1 basis-48 break-words">
            <p className="text-sm text-text-muted">{application.companyName}</p>
            <p className="text-base text-text-primary">{application.tokenName}</p>
            <p className="text-sm tabular-nums text-text-muted">{shareCount(application.quantity)}</p>
          </div>
          <Link
            to={`${DESTINATIONS.subscriptions.path}/${application.uuid}`}
            className={`${LINK} max-w-full break-words`}
          >
            {description}
          </Link>
        </li>
      ))}
    </ul>
  );
}

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
  const { role, applications, notices, recent } = useHoldingWork();
  const applicationsReady = role.isKnown && (!role.isInvestor || applications.isSuccess);
  const showApplications = role.isKnown && role.isInvestor && applications.isSuccess;
  const needsYou = showApplications ? applications.data.needsYou : [];
  const inProgress = showApplications ? applications.data.inProgress : [];
  const summary = notices.isError ? undefined : notices.summary;
  const complete = applicationsReady && summary !== undefined;
  const votes = summary?.openResolutions ?? 0;
  const dividends = summary?.dividendsWithoutRecord ?? 0;
  const showReadState =
    !role.isKnown || (role.isInvestor && !applications.isSuccess) || notices.isPending || notices.isError;

  return (
    <>
      {showReadState && (
        <div className="flex flex-col gap-3">
          {role.isUnavailable ? (
            <LoadError retry={() => role.retry()} busy={role.isLoading}>
              Your account type and applications could not be loaded.
            </LoadError>
          ) : !role.isKnown || (role.isInvestor && applications.isPending) ? (
            <Loading>Loading your applications…</Loading>
          ) : role.isInvestor && applications.isError ? (
            <LoadError retry={() => applications.refetch()} busy={applications.isFetching}>
              Your applications could not be loaded.
            </LoadError>
          ) : null}
          {notices.isPending ? (
            <Loading>Loading your notices…</Loading>
          ) : notices.isError ? (
            <LoadError retry={() => notices.retry()} busy={notices.isFetching}>
              Your notices could not be loaded.
            </LoadError>
          ) : null}
        </div>
      )}

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
        <Applications rows={needsYou} />
        {complete && votes === 0 && needsYou.length === 0 && (
          <p className="py-3 text-sm text-text-muted">
            {role.isInvestor ? 'No applications or votes need your attention.' : 'No votes need your attention.'}
          </p>
        )}
      </Section>

      <Section title="In progress">
        <Applications rows={inProgress} />
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
        {complete && dividends === 0 && inProgress.length === 0 && (
          <p className="py-3 text-sm text-text-muted">
            {role.isInvestor
              ? 'No applications or dividend records are in progress.'
              : 'No dividend records are in progress.'}
          </p>
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
          <p className="py-3 text-sm text-text-muted">Nothing has been published to you yet.</p>
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

import { Link } from 'react-router-dom';
import { DESTINATIONS, formatDateTime, formatShareCount } from '@ledova/shared';
import { Section, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { useHoldingWork } from '../hooks/useHoldingWork';
import type { ApplicationWork } from '../applicationWork';

const LINK = 'text-sm font-medium text-brand-light underline underline-offset-4 hover:text-brand-mid';

function Applications({ rows }: { rows: ApplicationWork[] }) {
  return (
    <ul className="divide-y divide-border-subtle">
      {rows.map(({ application, description }) => (
        <li key={application.uuid} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 py-3">
          <div className="min-w-0 flex-1 basis-48 break-words">
            <p className="text-sm text-text-muted">{application.companyName}</p>
            <p className="text-base text-text-primary">{application.tokenName}</p>
            <p className="text-sm tabular-nums text-text-muted">
              {formatShareCount(String(application.quantity))} {application.quantity === 1 ? 'share' : 'shares'}
            </p>
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

function ReadError({ children, retry, busy }: { children: string; retry: () => void; busy: boolean }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
      <p>{children}</p>
      <PageAction label="Try again" onClick={retry} disabled={busy} />
    </div>
  );
}

export function HoldingWork() {
  const { role, applications, notices } = useHoldingWork();
  const applicationsReady = role.isKnown && (!role.isInvestor || applications.isSuccess);
  const showApplications = role.isKnown && role.isInvestor && applications.isSuccess;
  const needsYou = showApplications ? applications.data.needsYou : [];
  const inProgress = showApplications ? applications.data.inProgress : [];
  const summary = notices.isError ? undefined : notices.summary;
  const complete = applicationsReady && summary !== undefined;
  const votes = summary?.openResolutions ?? 0;
  const dividends = summary?.dividendsWithoutRecord ?? 0;
  const published = summary?.publishedSince ?? 0;
  const showReadState =
    !role.isKnown || (role.isInvestor && !applications.isSuccess) || notices.isPending || notices.isError;

  return (
    <>
      {showReadState && (
        <div className="flex flex-col gap-3">
          {role.isUnavailable ? (
            <ReadError retry={() => void role.retry()} busy={role.isLoading}>
              We couldn&apos;t check your account type or applications.
            </ReadError>
          ) : !role.isKnown || (role.isInvestor && applications.isPending) ? (
            <p role="status" className="text-sm text-text-muted">
              Checking your applications…
            </p>
          ) : role.isInvestor && applications.isError ? (
            <ReadError retry={() => void applications.refetch()} busy={applications.isFetching}>
              We couldn&apos;t load all your applications.
            </ReadError>
          ) : null}
          {notices.isPending ? (
            <p role="status" className="text-sm text-text-muted">
              Checking your notices…
            </p>
          ) : notices.isError ? (
            <ReadError retry={() => void notices.retry()} busy={notices.isFetching}>
              We couldn&apos;t check your notices.
            </ReadError>
          ) : null}
        </div>
      )}

      <Section title="Needs you">
        {votes > 0 && (
          <div className="flex flex-wrap items-baseline justify-between gap-3 py-3">
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
          <div className="flex flex-wrap items-baseline justify-between gap-3 py-3">
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

      {published > 0 && (
        <p className="text-sm text-text-muted">
          {published} {published === 1 ? 'notice addressed' : 'notices addressed'} to you in the last 30 days.{' '}
          <Link to={DESTINATIONS.publications.path} className={LINK}>
            View notices
          </Link>
        </p>
      )}
    </>
  );
}

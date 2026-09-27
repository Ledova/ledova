import { Link } from 'react-router-dom';
import { DESTINATIONS, SUBSCRIPTION_COPY, formatDate, formatMoney } from '@ledova/shared';
import type { Subscription } from '@ledova/shared';
import { Row, Rows, Section, Status } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { applicationShares, applicationState } from './presentation';
import { useSubscriptions } from './useSubscriptions';

function ApplicationRow({ application }: { application: Subscription }) {
  const state = applicationState(application);
  return (
    <article className="min-w-0 break-words">
      <Section title={`${application.companyName} · ${application.tokenName}`}>
        <p className="py-2 text-sm text-text-primary">
          <Status tone={state.tone}>{state.words}</Status>
        </p>
        <Rows>
          <Row label="Share class">{application.tokenSymbol}</Row>
          <Row label="Shares applied for">{applicationShares(application.quantity)}</Row>
          <Row label="Price per share">
            <span className="break-all">{formatMoney(application.pricePerShare, application.currency)}</span>
          </Row>
          <Row label="Amount due">
            <span className="break-all">{formatMoney(application.amountDue, application.currency)}</span>
          </Row>
          <Row label="Drafted">{formatDate(application.createdAt)}</Row>
          {application.reference && (
            <Row label="Payment reference">
              <span className="break-all">{application.reference}</span>
            </Row>
          )}
        </Rows>
        <Link
          to={DESTINATIONS.subscriptionDetail.path.replace(':uuid', application.uuid)}
          className="w-fit py-2 text-sm text-brand-light underline underline-offset-4"
        >
          Open application
        </Link>
      </Section>
    </article>
  );
}

export default function SubscriptionsPage() {
  const { subscriptions, isLoading, hasError, moreFailed, hasMore, isLoadingMore, isRefreshing, retry, loadMore } =
    useSubscriptions();

  if (isLoading) return <Page loading />;

  return (
    <Page>
      <p className="text-sm text-text-muted">Your applications for shares, from draft through allotment or closure.</p>
      {hasError ? (
        <div role="alert" className="flex flex-col items-start gap-3 py-6">
          <p className="text-sm text-text-primary">
            Your applications could not be loaded. Try again before continuing.
          </p>
          <PageAction label="Try again" onClick={() => void retry()} disabled={isRefreshing} />
        </div>
      ) : (
        <>
          {subscriptions.length === 0 && !hasMore && !moreFailed ? (
            <Section title="No applications yet">
              <p className="py-3 text-sm text-text-muted">{SUBSCRIPTION_COPY.EMPTY_BODY}</p>
              <Link
                to={DESTINATIONS.directory.path}
                className="w-fit text-sm text-brand-light underline underline-offset-4"
              >
                Open Directory
              </Link>
            </Section>
          ) : (
            subscriptions.map((application) => <ApplicationRow key={application.uuid} application={application} />)
          )}
          {moreFailed ? (
            <div role="alert" className="flex flex-col items-start gap-3 py-3">
              <p className="text-sm text-text-primary">
                More applications could not be loaded. The list is incomplete.
              </p>
              <PageAction
                label="Try more applications again"
                onClick={() => void loadMore()}
                disabled={isLoadingMore}
              />
            </div>
          ) : (
            hasMore && (
              <div className="py-3">
                <PageAction
                  label={isLoadingMore ? 'Loading applications…' : 'Load more applications'}
                  onClick={() => void loadMore()}
                  disabled={isLoadingMore}
                />
              </div>
            )
          )}
        </>
      )}
    </Page>
  );
}

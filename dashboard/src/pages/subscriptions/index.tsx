import { marketQuantity } from '@ledova/shared';
import { generatePath } from 'react-router-dom';
import { DESTINATIONS, formatDate, formatMoney, useSubscriptions } from '@ledova/shared';
import type { Subscription } from '@ledova/shared';
import { LinkRow, Row, Rows, Section, Status, LoadError } from '@components/Ledger';
import { Page } from '@components/Page';
import { LoadMore } from '@components/List';
import { applicationState } from '@pages/subscriptions/shared/presentation';

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
          <Row label="Shares applied for">{marketQuantity(application.quantity)}</Row>
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
        <LinkRow
          to={generatePath(DESTINATIONS.subscriptionDetail.path, { uuid: application.uuid })}
          label={DESTINATIONS.subscriptionDetail.title}
        />
      </Section>
    </article>
  );
}

export default function SubscriptionsPage() {
  const { subscriptions, isLoading, hasError, moreFailed, hasMore, isLoadingMore, isRefreshing, retry, loadMore } =
    useSubscriptions();

  if (isLoading) return <Page narrow loading />;

  return (
    <Page narrow>
      {hasError ? (
        <LoadError retry={retry} busy={isRefreshing}>
          Your applications could not be loaded.
        </LoadError>
      ) : (
        <>
          {subscriptions.length === 0 && !hasMore && !moreFailed ? (
            <Section title="Your applications">
              <p className="py-3 text-sm text-text-muted">No applications yet.</p>
              <LinkRow to={DESTINATIONS.directory.path} label={DESTINATIONS.directory.title} />
            </Section>
          ) : (
            subscriptions.map((application) => <ApplicationRow key={application.uuid} application={application} />)
          )}
          <LoadMore
            noun={['application', 'applications']}
            hasMore={hasMore}
            failed={moreFailed}
            loading={isLoadingMore}
            disabled={isRefreshing}
            onLoad={() => void loadMore()}
          />
        </>
      )}
    </Page>
  );
}

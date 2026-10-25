import { marketQuantity } from '@ledova/shared';
import { generatePath } from 'react-router-dom';
import { DESTINATIONS, formatMoney, useSubscriptions } from '@ledova/shared';
import type { Subscription } from '@ledova/shared';
import { LinkRow, Section, Status, LoadError } from '@components/Ledger';
import { Page } from '@components/Page';
import { LoadMore } from '@components/List';
import { applicationState } from '@pages/subscriptions/shared/presentation';

function ApplicationRow({ application }: { application: Subscription }) {
  const state = applicationState(application);
  return (
    <LinkRow
      to={generatePath(DESTINATIONS.subscriptionDetail.path, { uuid: application.uuid })}
      label={`${application.companyName} · ${application.tokenName}`}
      aside={<Status tone={state.tone}>{state.words}</Status>}
    >
      <p className="break-words text-text-muted">
        {marketQuantity(application.quantity)} {application.tokenSymbol} shares ·{' '}
        {formatMoney(application.pricePerShare, application.currency)} per share
      </p>
    </LinkRow>
  );
}

export default function SubscriptionsPage() {
  const { subscriptions, isLoading, hasError, moreFailed, hasMore, isLoadingMore, isRefreshing, retry, loadMore } =
    useSubscriptions();

  if (isLoading) return <Page loading />;

  return (
    <Page>
      {hasError ? (
        <LoadError retry={retry} busy={isRefreshing}>
          Your applications could not be loaded.
        </LoadError>
      ) : (
        <>
          <Section title="Your applications">
            {subscriptions.length === 0 && !hasMore && !moreFailed ? (
              <>
                <p className="py-3 text-sm text-text-muted">No applications yet.</p>
                <LinkRow to={DESTINATIONS.directory.path} label={DESTINATIONS.directory.title} />
              </>
            ) : (
              <div className="divide-y divide-border-subtle">
                {subscriptions.map((application) => (
                  <ApplicationRow key={application.uuid} application={application} />
                ))}
              </div>
            )}
          </Section>
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

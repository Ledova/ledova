import { Link, useNavigate, useParams } from 'react-router-dom';
import { DESTINATIONS, formatDate, formatMoney, formatShareCount } from '@ledova/shared';
import { Row, Rows, Section, Status } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { SubscribeForm } from '@pages/subscriptions/SubscribeForm';
import { useCreateSubscription, useSubscribableWallets } from '@pages/subscriptions/useSubscriptions';
import { useDirectoryToken } from './useDirectory';

export default function DirectoryTokenPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const {
    token,
    operator,
    isLoading,
    notFound,
    hasError,
    retry,
    isRefreshing,
    operatorLoading,
    operatorFailed,
    operatorRefreshing,
    retryOperator,
  } = useDirectoryToken(uuid);
  const wallets = useSubscribableWallets(Boolean(token?.openOffering) && !hasError && !notFound);
  const create = useCreateSubscription((created) =>
    navigate(DESTINATIONS.subscriptionDetail.path.replace(':uuid', created)),
  );

  if (isLoading) return <Page loading />;

  if (hasError) {
    return (
      <Page>
        <div role="alert" className="flex flex-col items-start gap-3 py-6">
          <p className="text-sm text-text-primary">
            This share class could not be loaded. Try again before continuing.
          </p>
          <PageAction label="Try again" onClick={() => void retry()} disabled={isRefreshing} />
        </div>
      </Page>
    );
  }

  if (!token || notFound) {
    return (
      <Page>
        <Section title="Share class not available">
          <p className="py-2 text-sm text-text-muted">
            This share class is not available to you in the directory. It may have closed or your investor status may
            need updating.
          </p>
          <Link
            to={DESTINATIONS.directory.path}
            className="w-fit text-sm text-brand-light underline underline-offset-4"
          >
            Back to Directory
          </Link>
        </Section>
      </Page>
    );
  }

  const offering = token.openOffering;

  return (
    <Page>
      <p className="break-words text-sm text-text-muted">{token.company.displayName}</p>
      <div className="min-w-0 break-words">
        <Section title={token.name}>
          <Rows>
            <Row label="Symbol">{token.symbol}</Row>
            <Row label="Authorised shares">
              <span className="break-all">{formatShareCount(token.totalSupply)}</span>
            </Row>
            <Row label="Shares issued">
              {Number.isSafeInteger(token.issuedShares) && token.issuedShares >= 0
                ? formatShareCount(String(token.issuedShares))
                : 'Unavailable'}
            </Row>
            {token.company.industry && <Row label="Industry">{token.company.industry}</Row>}
            {[token.company.city, token.company.state].some(Boolean) && (
              <Row label="Location">{[token.company.city, token.company.state].filter(Boolean).join(', ')}</Row>
            )}
          </Rows>
        </Section>
      </div>
      <Section title="Current offering">
        <p className="py-2 text-sm text-text-primary">
          <Status tone={offering ? 'moving' : 'waiting'}>
            {offering ? 'Open for applications' : 'No offering open'}
          </Status>
        </p>
        {offering ? (
          <Rows>
            <Row label="Price per share">
              <span className="break-all">{formatMoney(offering.pricePerShare, offering.priceCurrency)}</span>
            </Row>
            <Row label="Opened">{formatDate(offering.opensAt)}</Row>
            <Row label="Closes">{offering.closesAt ? formatDate(offering.closesAt) : 'No closing date'}</Row>
          </Rows>
        ) : (
          <p className="text-sm text-text-muted">
            An offering will appear here when the operator has approved it and its opening time has arrived.
          </p>
        )}
      </Section>
      {offering &&
        (wallets.isLoading ? (
          <p role="status" className="py-3 text-sm text-text-muted">
            Loading your receiving wallets…
          </p>
        ) : wallets.hasError ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-3">
            <p className="text-sm text-text-primary">
              Your receiving wallets could not be loaded. Try again before applying.
            </p>
            <PageAction
              label="Try wallets again"
              onClick={() => void wallets.retry()}
              disabled={wallets.isRefreshing}
            />
          </div>
        ) : (
          <SubscribeForm
            key={offering.uuid}
            offering={offering}
            wallets={wallets.wallets}
            busy={create.isPending}
            error={create.error}
            onSubscribe={({ wallet, quantity }) => create.mutate({ offering: offering.uuid, wallet, quantity })}
          />
        ))}
      <Section title="Payments">
        {operatorLoading ? (
          <p role="status" className="text-sm text-text-muted">
            Loading operator details…
          </p>
        ) : operatorFailed ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-2">
            <p className="text-sm text-text-primary">Operator details could not be loaded.</p>
            <PageAction
              label="Try operator details again"
              onClick={() => void retryOperator()}
              disabled={operatorRefreshing}
            />
          </div>
        ) : (
          <p className="py-2 text-sm text-text-muted">
            {operator?.name ?? 'The operator'} reviews your application. After it is accepted, open the application for
            the exact amount and payment reference. Creating a draft does not send a payment.
          </p>
        )}
      </Section>
      <Link to={DESTINATIONS.directory.path} className="w-fit text-sm text-brand-light underline underline-offset-4">
        Back to Directory
      </Link>
    </Page>
  );
}

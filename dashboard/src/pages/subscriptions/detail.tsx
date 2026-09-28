import { useNavigate, useParams } from 'react-router-dom';
import {
  DESTINATIONS,
  SUBSCRIPTION_COPY,
  SUBSCRIPTION_SUBMITTABLE_STATUSES,
  SUBSCRIPTION_WITHDRAWABLE_STATUSES,
  formatMoney,
  getErrorMessage,
} from '@ledova/shared';
import type { SubscriptionDetail } from '@ledova/shared';
import { Row, Rows, Section, Status, Timeline, type TimelineEvent } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { PaymentInstructionCard } from './PaymentInstructionCard';
import { useSubscription } from './useSubscriptions';
import { applicationShares, applicationState } from './presentation';

const ACTION_ERROR_FALLBACK = 'The request was refused. Please try again.';
const MONEY_HELD = ['awaiting_payment', 'paid'];

const NEXT: Record<string, string> = {
  draft: SUBSCRIPTION_COPY.DRAFT_HELP,
  submitted: 'The operator is reviewing it. Nothing is payable until it is accepted.',
  accepted: 'The payment instruction is being issued.',
  paid: SUBSCRIPTION_COPY.PAID_HELP,
};

function history(subscription: SubscriptionDetail): TimelineEvent[] {
  const closed = subscription.status === 'withdrawn' ? 'Withdrawn' : 'Rejected';
  const events: [string, string | null | undefined][] = [
    ['Drafted', subscription.createdAt],
    ['Submitted for review', subscription.submittedAt],
    ['Accepted by the operator', subscription.acceptedAt],
    ['Payment instruction issued', subscription.paymentInstructionIssuedAt],
    ['Payment received', subscription.paymentReceivedOn],
    ['Shares allotted', subscription.allottedAt],
    ['Refunded', subscription.refundedAt],
    [closed, subscription.closedAt],
  ];
  return events.filter((event): event is [string, string] => Boolean(event[1])).map(([label, at]) => ({ label, at }));
}

function Summary({ subscription }: { subscription: SubscriptionDetail }) {
  const status = applicationState(subscription);
  const amount = (value: string) => formatMoney(value, subscription.currency);
  return (
    <div className="min-w-0 break-words">
      <Section title={`${subscription.companyName} · ${subscription.tokenName}`}>
        <Rows>
          <Row label="Status">
            <Status tone={status.tone}>{status.words}</Status>
          </Row>
          <Row label="Shares applied for">{applicationShares(subscription.quantity)}</Row>
          {subscription.allottedQuantity !== null && subscription.allottedQuantity !== subscription.quantity && (
            <Row label="Shares to be allotted">{applicationShares(subscription.allottedQuantity)}</Row>
          )}
          <Row label="Price per share">{amount(subscription.pricePerShare)}</Row>
          <Row label="Amount due">{amount(subscription.amountDue)}</Row>
          {subscription.amountReceived && <Row label="Amount received">{amount(subscription.amountReceived)}</Row>}
          {subscription.status === 'awaiting_payment' && subscription.amountOutstanding && (
            <Row label="Amount outstanding">{amount(subscription.amountOutstanding)}</Row>
          )}
          {subscription.refundAmount && (
            <Row label={subscription.refundedAt ? 'Refunded' : 'Refund owed to you'}>
              {amount(subscription.refundAmount)}
            </Row>
          )}
          <Row label="Receiving wallet">
            <span className="break-all font-mono">{subscription.walletAddress}</span>
          </Row>
          {subscription.reference && <Row label="Payment reference">{subscription.reference}</Row>}
        </Rows>
      </Section>
    </div>
  );
}

export default function SubscriptionDetailPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const { subscription, isLoading, notFound, hasError, isRefreshing, retry, submit, withdraw } = useSubscription(uuid);

  if (isLoading) {
    return <Page loading />;
  }

  if (hasError) {
    return (
      <Page>
        <div role="alert" className="flex flex-col items-start gap-3 py-6">
          <p className="text-sm text-text-primary">
            This application could not be loaded. Try again before continuing.
          </p>
          <PageAction label="Try again" onClick={() => void retry()} disabled={isRefreshing} />
        </div>
      </Page>
    );
  }

  if (!subscription || notFound) {
    return (
      <Page
        actions={<PageAction label="Back to Applications" onClick={() => navigate(DESTINATIONS.subscriptions.path)} />}
      >
        <Section title="Not available">
          <p className="text-sm text-text-muted">This application is not one of yours, or it no longer exists.</p>
        </Section>
      </Page>
    );
  }

  const hasPayment = Boolean(subscription.amountReceived && !/^0+(\.0+)?$/.test(subscription.amountReceived));
  const canSubmit = SUBSCRIPTION_SUBMITTABLE_STATUSES.includes(subscription.status);
  const canWithdraw = SUBSCRIPTION_WITHDRAWABLE_STATUSES.includes(subscription.status) && !hasPayment;
  const busy = submit.isPending || withdraw.isPending || isRefreshing;
  const message = getErrorMessage(submit.error ?? withdraw.error, ACTION_ERROR_FALLBACK);
  const next = NEXT[subscription.status];

  return (
    <Page
      actions={
        (canSubmit || canWithdraw) && (
          <>
            {canWithdraw && (
              <PageAction
                label="Withdraw"
                onClick={() => withdraw.mutate('Withdrawn by the investor')}
                disabled={busy}
              />
            )}
            {canSubmit && (
              <PageAction label="Submit for review" onClick={() => submit.mutate()} disabled={busy} primary />
            )}
          </>
        )
      }
    >
      {message && (
        <p role="alert" className="text-sm text-error-light">
          {message}
        </p>
      )}

      <Summary subscription={subscription} />

      {subscription.paymentInstruction && (
        <PaymentInstructionCard instruction={subscription.paymentInstruction} paymentRecorded={hasPayment} />
      )}
      {subscription.status === 'awaiting_payment' && !subscription.paymentInstruction && (
        <Section title="Payment instruction unavailable">
          <p className="py-2 text-sm text-text-muted">
            Ask the operator for your payment instruction before sending money.
          </p>
        </Section>
      )}

      <Section title="History">
        <Timeline events={history(subscription)} />
        {next && <p className="pt-1 text-sm text-text-secondary">Next: {next}</p>}
        {MONEY_HELD.includes(subscription.status) && hasPayment && (
          <p className="text-sm text-text-muted">{SUBSCRIPTION_COPY.MONEY_IN_HELP}</p>
        )}
      </Section>
    </Page>
  );
}

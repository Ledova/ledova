import { Link, useParams } from 'react-router-dom';
import {
  DESTINATIONS,
  SUBSCRIPTION_COPY,
  SUBSCRIPTION_SUBMITTABLE_STATUSES,
  SUBSCRIPTION_WITHDRAWABLE_STATUSES,
  formatAmount,
  formatShareCount,
  getErrorMessage,
} from '@ledova/shared';
import type { SubscriptionDetail } from '@ledova/shared';
import { Row, Rows, Section, Status, Timeline, type TimelineEvent, type Tone } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { PaymentInstructionCard } from './PaymentInstructionCard';
import { useSubscription } from './useSubscriptions';

const ACTION_ERROR_FALLBACK = 'The request was refused. Please try again.';

const STATUS: Record<string, { words: string; tone: Tone }> = {
  draft: { words: 'Draft', tone: 'waiting' },
  submitted: { words: 'Under review by the operator', tone: 'moving' },
  accepted: { words: 'Accepted, payment instruction next', tone: 'moving' },
  awaiting_payment: { words: 'Awaiting your payment', tone: 'moving' },
  paid: { words: 'Payment received, allotment next', tone: 'moving' },
  allotted: { words: 'Shares allotted', tone: 'done' },
  rejected: { words: 'Rejected', tone: 'closed' },
  withdrawn: { words: 'Withdrawn', tone: 'closed' },
  refunded: { words: 'Refunded', tone: 'closed' },
};

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
  const status = STATUS[subscription.status] ?? { words: subscription.statusDisplay, tone: 'moving' as Tone };
  const amount = (value: string | null | undefined) => formatAmount(value, subscription.currency);
  return (
    <Section title={`${subscription.companyName} · ${subscription.tokenName}`}>
      <Rows>
        <Row label="Status">
          <Status tone={status.tone}>{status.words}</Status>
        </Row>
        <Row label="Shares applied for">{formatShareCount(String(subscription.quantity))}</Row>
        {subscription.allottedQuantity !== null && subscription.allottedQuantity !== subscription.quantity && (
          <Row label="Shares to be allotted">{formatShareCount(String(subscription.allottedQuantity))}</Row>
        )}
        <Row label="Price per share">{amount(subscription.pricePerShare)}</Row>
        <Row label="Amount due">{amount(subscription.amountDue)}</Row>
        {subscription.amountReceived && <Row label="Amount received">{amount(subscription.amountReceived)}</Row>}
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
  );
}

export default function SubscriptionDetailPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const { subscription, isLoading, notFound, submit, withdraw } = useSubscription(uuid);

  if (isLoading) {
    return <Page loading />;
  }

  if (!subscription || notFound) {
    return (
      <Page>
        <Section title="Not available">
          <p className="text-sm text-text-muted">This application is not one of yours, or it no longer exists.</p>
          <Link
            to={DESTINATIONS.subscriptions.path}
            className="text-sm font-medium text-brand-light hover:text-brand-subtle"
          >
            All applications
          </Link>
        </Section>
      </Page>
    );
  }

  const canSubmit = SUBSCRIPTION_SUBMITTABLE_STATUSES.includes(subscription.status);
  const canWithdraw = SUBSCRIPTION_WITHDRAWABLE_STATUSES.includes(subscription.status) && !subscription.amountReceived;
  const busy = submit.isPending || withdraw.isPending;
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

      {subscription.paymentInstruction && <PaymentInstructionCard instruction={subscription.paymentInstruction} />}

      <Section title="History">
        <Timeline events={history(subscription)} />
        {next && <p className="pt-1 text-sm text-text-secondary">Next: {next}</p>}
        {subscription.amountReceived && !canWithdraw && (
          <p className="text-sm text-text-muted">{SUBSCRIPTION_COPY.MONEY_IN_HELP}</p>
        )}
      </Section>
    </Page>
  );
}

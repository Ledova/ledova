import { Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  formatDate,
  formatMoney,
  getErrorMessage,
  SUBSCRIPTION_COPY,
  SUBSCRIPTION_SUBMITTABLE_STATUSES,
  SUBSCRIPTION_WITHDRAWABLE_STATUSES,
} from '@ledova/shared';
import type { ApplicationsStackParamList } from '../../navigation/ApplicationsStackNavigator';
import { Action, Row, Rows, Section } from '../../components/Ledger';
import { getSessionEpoch } from '../../services/sessionScope';
import { ApplicationsPage, useApplicationStyles } from './ApplicationsPage';
import { PaymentInstruction } from './PaymentInstruction';
import { useSubscription } from './useApplications';
import { applicationHistory, applicationShares, applicationState } from './presentation';

const NEXT: Record<string, string> = {
  draft: SUBSCRIPTION_COPY.DRAFT_HELP,
  submitted: 'The operator is reviewing it. Nothing is payable until it is accepted.',
  accepted: 'The payment instruction is being issued.',
  paid: SUBSCRIPTION_COPY.PAID_HELP,
};

export function ApplicationDetailScreen() {
  const { params } = useRoute<RouteProp<ApplicationsStackParamList, 'ApplicationDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<ApplicationsStackParamList>>();
  const styles = useApplicationStyles();
  const { subscription, isLoading, notFound, hasError, isRefreshing, retry, submit, withdraw } = useSubscription(
    params.uuid,
  );
  const hasPayment = Boolean(subscription?.amountReceived && !/^0+(\.0+)?$/.test(subscription.amountReceived));
  const canSubmit = !!subscription && SUBSCRIPTION_SUBMITTABLE_STATUSES.includes(subscription.status);
  const canWithdraw = !!subscription && SUBSCRIPTION_WITHDRAWABLE_STATUSES.includes(subscription.status) && !hasPayment;
  const busy = submit.isPending || withdraw.isPending || isRefreshing;
  const reliable = !isLoading && !hasError && !notFound && !!subscription;
  const amount = (value: string) => formatMoney(value, subscription!.currency);
  const message = getErrorMessage(submit.error ?? withdraw.error, 'The request was refused. Please try again.');
  return (
    <ApplicationsPage
      title="Application"
      loading={isLoading}
      refreshing={isRefreshing}
      refresh={() => {
        if (!submit.isPending && !withdraw.isPending) void retry();
      }}
    >
      <Action label="Back to Applications" onPress={() => navigation.navigate('ApplicationsMain')} />
      {hasError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.message}>
            This application could not be loaded. Try again before continuing.
          </Text>
          <Action label="Try again" onPress={() => void retry()} disabled={isRefreshing} />
        </View>
      ) : !subscription || notFound ? (
        <Section title="Not available">
          <Text style={styles.help}>This application is not one of yours, or it no longer exists.</Text>
        </Section>
      ) : (
        <>
          <Section title={`${subscription.companyName} · ${subscription.tokenName}`}>
            <Rows>
              <Row label="Status">{applicationState(subscription)}</Row>
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
              <Row label="Receiving wallet">{subscription.walletAddress}</Row>
              {subscription.reference && <Row label="Payment reference">{subscription.reference}</Row>}
            </Rows>
          </Section>
          {(canSubmit || canWithdraw) && (
            <Section title="Next step">
              {message && (
                <Text accessibilityRole="alert" style={styles.message}>
                  {message}
                </Text>
              )}
              {canSubmit && (
                <Action
                  label={submit.isPending ? 'Submitting…' : 'Submit for review'}
                  primary
                  disabled={busy}
                  onPress={() => {
                    if (reliable && canSubmit && !busy) {
                      withdraw.reset();
                      submit.mutate(getSessionEpoch());
                    }
                  }}
                />
              )}
              {canWithdraw && (
                <Action
                  label={withdraw.isPending ? 'Withdrawing…' : 'Withdraw'}
                  disabled={busy}
                  onPress={() => {
                    if (reliable && canWithdraw && !busy) {
                      submit.reset();
                      withdraw.mutate({ reason: 'Withdrawn by the investor', epoch: getSessionEpoch() });
                    }
                  }}
                />
              )}
            </Section>
          )}
          {subscription.paymentInstruction && (
            <PaymentInstruction instruction={subscription.paymentInstruction} paymentRecorded={hasPayment} />
          )}
          {subscription.status === 'awaiting_payment' && !subscription.paymentInstruction && (
            <Section title="Payment instruction unavailable">
              <Text style={styles.help}>Ask the operator for your payment instruction before sending money.</Text>
            </Section>
          )}
          <Section title="History">
            <Rows>
              {applicationHistory(subscription).map(([label, at]) => (
                <Row key={label} label={label}>
                  {formatDate(at)}
                </Row>
              ))}
            </Rows>
            {NEXT[subscription.status] && <Text style={styles.help}>Next: {NEXT[subscription.status]}</Text>}
            {['awaiting_payment', 'paid'].includes(subscription.status) && hasPayment && (
              <Text style={styles.help}>{SUBSCRIPTION_COPY.MONEY_IN_HELP}</Text>
            )}
          </Section>
        </>
      )}
    </ApplicationsPage>
  );
}

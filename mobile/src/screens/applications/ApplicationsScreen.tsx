import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { formatDate, formatMoney, useSubscriptions } from '@ledova/shared';
import type { ApplicationsStackParamList } from '../../navigation/ApplicationsStackNavigator';
import { Action, LinkRow, Row, Rows, Section } from '../../components/Ledger';
import { ApplicationsPage, useApplicationStyles } from './ApplicationsPage';
import { applicationShares, applicationState } from './presentation';

export function ApplicationsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ApplicationsStackParamList>>();
  const styles = useApplicationStyles();
  const { subscriptions, isLoading, hasError, moreFailed, hasMore, isLoadingMore, isRefreshing, retry, loadMore } =
    useSubscriptions();
  return (
    <ApplicationsPage loading={isLoading} refreshing={isRefreshing} refresh={() => void retry()}>
      {hasError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.message}>
            Your applications could not be loaded. Try again before continuing.
          </Text>
          <Action label="Try again" onPress={() => void retry()} disabled={isRefreshing} />
        </View>
      ) : (
        <>
          {subscriptions.length === 0 && !hasMore && !moreFailed ? (
            <Section title="Your applications">
              <Text style={styles.help}>No applications yet.</Text>
              <LinkRow
                label="Directory"
                onPress={() => navigation.getParent()?.navigate('Directory', { screen: 'DirectoryMain' })}
              />
            </Section>
          ) : (
            subscriptions.map((application) => (
              <Section key={application.uuid} title={`${application.companyName} · ${application.tokenName}`}>
                <Text style={styles.message}>{applicationState(application)}</Text>
                <Rows>
                  <Row label="Share class">{application.tokenSymbol}</Row>
                  <Row label="Shares applied for">{applicationShares(application.quantity)}</Row>
                  <Row label="Price per share">{formatMoney(application.pricePerShare, application.currency)}</Row>
                  <Row label="Amount due">{formatMoney(application.amountDue, application.currency)}</Row>
                  <Row label="Drafted">{formatDate(application.createdAt)}</Row>
                  {application.reference && <Row label="Payment reference">{application.reference}</Row>}
                </Rows>
                <LinkRow
                  label="Application"
                  accessibilityLabel={`Open application ${application.reference || application.uuid}`}
                  onPress={() => navigation.navigate('ApplicationDetail', { uuid: application.uuid })}
                />
              </Section>
            ))
          )}
          {moreFailed ? (
            <View style={styles.group}>
              <Text accessibilityRole="alert" style={styles.message}>
                More applications could not be loaded. The list is incomplete.
              </Text>
              <Action label="Try more applications again" onPress={() => void loadMore()} disabled={isRefreshing} />
            </View>
          ) : (
            hasMore && (
              <Action
                label={isLoadingMore ? 'Loading applications…' : 'Load more applications'}
                onPress={() => void loadMore()}
                disabled={isRefreshing}
              />
            )
          )}
        </>
      )}
    </ApplicationsPage>
  );
}

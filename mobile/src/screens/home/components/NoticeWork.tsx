import { Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { formatDateTime, usePublicationSummary } from '@ledova/shared';
import { Action, Section } from '../../../components/Ledger';
import { useThemedStyles } from '../../../contexts';
import type { RootStackParamList } from '../../../navigation/AppNavigator';

export function NoticeWork() {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const notices = usePublicationSummary();
  const summary = notices.isError ? undefined : notices.summary;
  const styles = useThemedStyles((theme) => ({
    block: { gap: 12 },
    message: { fontFamily: theme.fontFamily.regular, fontSize: 15, lineHeight: 23, color: theme.colors.text.primary },
    detail: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
  }));
  const open = () => navigation.navigate('MainApp', { screen: 'Main', params: { screen: 'Publications' } } as never);

  if (notices.isPending) return <Text style={styles.detail}>Checking your notices…</Text>;
  if (notices.isError)
    return (
      <View style={styles.block}>
        <Text accessibilityRole="alert" style={styles.detail}>
          We couldn&apos;t check your notices.
        </Text>
        <Action label="Try notices again" onPress={() => void notices.retry()} disabled={notices.isFetching} />
      </View>
    );
  if (!summary) return null;

  const votes = summary.openResolutions;
  const dividends = summary.dividendsWithoutRecord;
  const published = summary.publishedSince;
  return (
    <>
      <Section title="Votes needing you">
        {votes > 0 ? (
          <View style={styles.block}>
            <Text style={styles.message}>
              {votes} {votes === 1 ? 'resolution awaits' : 'resolutions await'} your vote
            </Text>
            {summary.nextClosesAt && (
              <Text style={styles.detail}>
                {votes === 1 ? 'Closes' : 'First closes'} {formatDateTime(summary.nextClosesAt)}
              </Text>
            )}
            <Action label="View notices to vote" onPress={open} />
          </View>
        ) : (
          <Text style={styles.detail}>No votes need your attention.</Text>
        )}
      </Section>
      <Section title="Dividend records in progress">
        {dividends > 0 ? (
          <View style={styles.block}>
            <Text style={styles.message}>
              {dividends} {dividends === 1 ? 'dividend awaits' : 'dividends await'} a payment record from the company
            </Text>
            <Action label="View dividend notices" onPress={open} />
          </View>
        ) : (
          <Text style={styles.detail}>No dividend records are in progress.</Text>
        )}
      </Section>
      {published > 0 && (
        <View style={styles.block}>
          <Text style={styles.detail}>
            {published} {published === 1 ? 'notice addressed' : 'notices addressed'} to you in the last 30 days.
          </Text>
          <Action label="View notices" onPress={open} />
        </View>
      )}
    </>
  );
}

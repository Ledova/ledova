import { Text, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import {
  PUBLICATION_COPY,
  PUBLICATION_KIND_LABELS,
  SUBSCRIPTION_IN_PROGRESS_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
  formatDate,
  formatDateTime,
  useResolutionStatus,
  type Publication,
  type Subscription,
  type SubscriptionStatus,
} from '@ledova/shared';
import { Action, Section } from '../../../components/Ledger';
import { useThemedStyles } from '../../../contexts';
import type { RootStackParamList } from '../../../navigation/AppNavigator';
import { applicationShares } from '../../applications/presentation';
import type { useHoldingWork } from '../useHoldingWork';

const NEEDS_YOU: Partial<Record<SubscriptionStatus, string>> = {
  draft: 'Review and submit your draft',
  awaiting_payment: 'View your payment instruction',
};

function RecentNotice({ publication }: { publication: Publication }) {
  const open = useResolutionStatus(publication) === 'open';
  const styles = useThemedStyles((theme) => ({
    notice: { gap: 4, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border.subtle },
    message: { fontFamily: theme.fontFamily.regular, fontSize: 15, lineHeight: 23, color: theme.colors.text.primary },
    detail: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
  }));
  return (
    <View style={styles.notice}>
      <Text style={styles.detail}>
        {publication.companyName} · {PUBLICATION_KIND_LABELS[publication.kind]}
      </Text>
      <Text style={styles.message}>{publication.title}</Text>
      {open && publication.closesAt && (
        <Text style={styles.detail}>
          {PUBLICATION_COPY.OPEN_UNTIL} {formatDateTime(publication.closesAt)}
        </Text>
      )}
      <Text style={styles.detail}>{formatDate(publication.createdAt)}</Text>
    </View>
  );
}

export function HoldingWork({ work }: { work: ReturnType<typeof useHoldingWork> }) {
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const { known, investing, applications, notices, recent } = work;
  const summary = notices.isError ? undefined : notices.summary;
  const rows = investing && applications.isSuccess ? applications.data : [];
  const needsYou = rows.filter((application) => NEEDS_YOU[application.status]);
  const inProgress = rows.filter((application) => SUBSCRIPTION_IN_PROGRESS_STATUSES.includes(application.status));
  const complete = known && (!investing || applications.isSuccess) && summary !== undefined;
  const votes = summary?.openResolutions ?? 0;
  const dividends = summary?.dividendsWithoutRecord ?? 0;
  const styles = useThemedStyles((theme) => ({
    block: { gap: 12 },
    application: { gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border.subtle },
    message: { fontFamily: theme.fontFamily.regular, fontSize: 15, lineHeight: 23, color: theme.colors.text.primary },
    detail: { fontFamily: theme.fontFamily.regular, fontSize: 14, lineHeight: 21, color: theme.colors.text.muted },
  }));
  const openNotices = () =>
    navigation.navigate('MainApp', { screen: 'Main', params: { screen: 'Publications' } } as never);
  const openApplication = (uuid: string) =>
    navigation.navigate('MainApp', {
      screen: 'Main',
      params: { screen: 'Applications', params: { screen: 'ApplicationDetail', params: { uuid } } },
    } as never);
  const renderApplications = (
    applications: Subscription[],
    descriptions: Partial<Record<SubscriptionStatus, string>>,
  ) =>
    applications.map((application) => (
      <View key={application.uuid} style={styles.application}>
        <Text style={styles.detail}>{application.companyName}</Text>
        <Text style={styles.message}>{application.tokenName}</Text>
        <Text style={styles.detail}>
          {applicationShares(application.quantity)} {application.quantity === 1 ? 'share' : 'shares'}
        </Text>
        <Action
          label={descriptions[application.status]!}
          accessibilityLabel={`${descriptions[application.status]}: ${application.companyName}, ${application.tokenName}`}
          onPress={() => openApplication(application.uuid)}
        />
      </View>
    ));

  return (
    <>
      {work.accountUnavailable ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.detail}>
            We couldn&apos;t check your account type or applications.
          </Text>
          <Action label="Try account again" onPress={() => void work.retryAccount()} disabled={work.checkingAccount} />
        </View>
      ) : !known || (investing && applications.isPending) ? (
        <Text style={styles.detail}>Checking your applications…</Text>
      ) : investing && applications.isError ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.detail}>
            We couldn&apos;t load all your applications.
          </Text>
          <Action
            label="Try applications again"
            onPress={() => void applications.refetch()}
            disabled={applications.isFetching}
          />
        </View>
      ) : null}
      {notices.isPending ? (
        <Text style={styles.detail}>Checking your notices…</Text>
      ) : notices.isError ? (
        <View style={styles.block}>
          <Text accessibilityRole="alert" style={styles.detail}>
            We couldn&apos;t check your notices.
          </Text>
          <Action label="Try notices again" onPress={() => void notices.retry()} disabled={notices.isFetching} />
        </View>
      ) : null}
      <Section title="Needs you">
        {votes > 0 && (
          <View style={styles.block}>
            <Text style={styles.message}>
              {votes} {votes === 1 ? 'resolution awaits' : 'resolutions await'} your vote
            </Text>
            {summary?.nextClosesAt && (
              <Text style={styles.detail}>
                {votes === 1 ? 'Closes' : 'First closes'} {formatDateTime(summary.nextClosesAt)}
              </Text>
            )}
            <Action label="View notices to vote" onPress={openNotices} />
          </View>
        )}
        {renderApplications(needsYou, NEEDS_YOU)}
        {complete && votes === 0 && needsYou.length === 0 && (
          <Text style={styles.detail}>
            {investing ? 'No applications or votes need your attention.' : 'No votes need your attention.'}
          </Text>
        )}
      </Section>
      <Section title="In progress">
        {renderApplications(inProgress, SUBSCRIPTION_STATUS_LABELS)}
        {dividends > 0 && (
          <View style={styles.block}>
            <Text style={styles.message}>
              {dividends} {dividends === 1 ? 'dividend awaits' : 'dividends await'} a payment record from the company
            </Text>
            <Action label="View dividend notices" onPress={openNotices} />
          </View>
        )}
        {complete && dividends === 0 && inProgress.length === 0 && (
          <Text style={styles.detail}>
            {investing
              ? 'No applications or dividend records are in progress.'
              : 'No dividend records are in progress.'}
          </Text>
        )}
      </Section>
      <Section title="Recently published to you">
        {recent.isPending ? (
          <Text style={styles.detail}>Checking what was published to you…</Text>
        ) : recent.isError ? (
          <View style={styles.block}>
            <Text accessibilityRole="alert" style={styles.detail}>
              We couldn&apos;t load what was published to you.
            </Text>
            <Action
              label="Try recent notices again"
              onPress={() => void recent.refetch()}
              disabled={recent.isFetching}
            />
          </View>
        ) : recent.data.length === 0 ? (
          <Text style={styles.detail}>Nothing has been published to you yet.</Text>
        ) : (
          recent.data.map((publication) => <RecentNotice key={publication.uuid} publication={publication} />)
        )}
        <Action label="View all notices" onPress={openNotices} />
      </Section>
    </>
  );
}

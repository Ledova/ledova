import React from 'react';
import { View, Text } from 'react-native';
import {
  CheckCircleIcon,
  WarningCircleIcon,
  ClockCountdownIcon,
  ArrowCounterClockwiseIcon,
} from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../../../../contexts';

interface StatusBannersProps {
  isVerified: boolean;
  showPendingBanner: boolean;
  showOnHoldBanner: boolean;
  showRejectedBanner: boolean;
  showRetryBanner: boolean;
  rejectionLabels?: string[] | null;
  plain?: boolean;
}

const COPY = {
  verified: { title: 'Already Verified', body: 'Your identity has been verified successfully.' },
  pending: {
    title: 'Verification Submitted',
    body: "Your documents have been submitted. We'll review them shortly and notify you of the result.",
  },
  onHold: {
    title: 'Verification On Hold',
    body: 'Your verification is currently on hold. We may need additional information. Please check back later or contact support.',
  },
  rejected: {
    title: 'Verification Rejected',
    body: 'Unfortunately, your verification was not approved. You may retry with different documents or contact support for assistance.',
  },
  retry: {
    title: 'Retry Needed',
    body: 'Your previous verification attempt needs to be retried. Please try again with clearer documents.',
  },
} as const;

function Outcome({
  icon,
  title,
  tone,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tone: string;
  body: string;
  children?: React.ReactNode;
}) {
  const styles = useThemedStyles((theme) => ({
    outcome: { gap: theme.spacing.xs },
    heading: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    title: { fontFamily: theme.fontFamily.medium, fontSize: theme.fontSize.sm, color: tone },
    body: {
      fontFamily: theme.fontFamily.regular,
      fontSize: theme.fontSize.sm,
      lineHeight: 21,
      color: theme.colors.text.secondary,
    },
  }));
  return (
    <View style={styles.outcome}>
      <View style={styles.heading}>
        {icon}
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      </View>
      <Text style={styles.body}>{body}</Text>
      {children}
    </View>
  );
}

export function StatusBanners({
  isVerified,
  showPendingBanner,
  showOnHoldBanner,
  showRejectedBanner,
  showRetryBanner,
  rejectionLabels,
  plain = false,
}: StatusBannersProps) {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    successContainer: {
      alignItems: 'center',
      paddingVertical: theme.spacing.xl,
      paddingHorizontal: theme.spacing.lg,
      backgroundColor: `${theme.colors.status.success.icon}20`,
      borderWidth: 1,
      borderColor: theme.colors.badge.success.background,
      borderRadius: theme.borderRadius.lg,
      marginBottom: theme.spacing.lg,
    },
    successTitle: {
      fontSize: theme.fontSize.lg,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.status.success.text,
      marginTop: theme.spacing.sm,
    },
    pendingContainer: {
      alignItems: 'center',
      paddingVertical: theme.spacing.xl,
      paddingHorizontal: theme.spacing.lg,
      backgroundColor: `${theme.colors.interactive.active}20`,
      borderWidth: 1,
      borderColor: theme.colors.interactive.active,
      borderRadius: theme.borderRadius.lg,
      marginBottom: theme.spacing.lg,
    },
    pendingTitle: {
      fontSize: theme.fontSize.lg,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.interactive.active,
      marginTop: theme.spacing.sm,
    },
    warningContainer: {
      alignItems: 'center',
      paddingVertical: theme.spacing.xl,
      paddingHorizontal: theme.spacing.lg,
      backgroundColor: `${theme.colors.status.warning.icon}15`,
      borderWidth: 1,
      borderColor: `${theme.colors.status.warning.icon}40`,
      borderRadius: theme.borderRadius.lg,
      marginBottom: theme.spacing.lg,
    },
    warningTitle: {
      fontSize: theme.fontSize.lg,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.status.warning.text,
      marginTop: theme.spacing.sm,
    },
    rejectedContainer: {
      alignItems: 'center',
      paddingVertical: theme.spacing.xl,
      paddingHorizontal: theme.spacing.lg,
      backgroundColor: theme.colors.error.backgroundSubtle,
      borderWidth: 1,
      borderColor: theme.colors.form.borderError,
      borderRadius: theme.borderRadius.lg,
      marginBottom: theme.spacing.lg,
    },
    rejectedTitle: {
      fontSize: theme.fontSize.lg,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.form.error,
      marginTop: theme.spacing.sm,
    },
    bannerText: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.secondary,
      textAlign: 'center',
      marginTop: theme.spacing.xs,
    },
    rejectionReasons: {
      marginTop: theme.spacing.sm,
      width: '100%',
    },
    reasonsLabel: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.muted,
      textTransform: 'uppercase',
      marginTop: theme.spacing.sm,
    },
    reasonItem: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.secondary,
      marginTop: theme.spacing.xs,
    },
  }));
  if (plain) {
    const size = theme.icon.sizes.md;
    return (
      <>
        {isVerified && (
          <Outcome
            icon={<CheckCircleIcon size={size} color={theme.colors.status.success.icon} weight="fill" />}
            tone={theme.colors.status.success.text}
            {...COPY.verified}
          />
        )}
        {showPendingBanner && (
          <Outcome
            icon={<CheckCircleIcon size={size} color={theme.colors.interactive.active} weight="fill" />}
            tone={theme.colors.interactive.active}
            {...COPY.pending}
          />
        )}
        {showOnHoldBanner && (
          <Outcome
            icon={<ClockCountdownIcon size={size} color={theme.colors.status.warning.icon} />}
            tone={theme.colors.status.warning.text}
            {...COPY.onHold}
          />
        )}
        {showRejectedBanner && (
          <Outcome
            icon={<WarningCircleIcon size={size} color={theme.colors.status.error.icon} />}
            tone={theme.colors.form.error}
            {...COPY.rejected}
          >
            <RejectionReasons labels={rejectionLabels} />
          </Outcome>
        )}
        {showRetryBanner && (
          <Outcome
            icon={<ArrowCounterClockwiseIcon size={size} color={theme.colors.status.warning.icon} />}
            tone={theme.colors.status.warning.text}
            {...COPY.retry}
          >
            <RejectionReasons labels={rejectionLabels} />
          </Outcome>
        )}
      </>
    );
  }
  return (
    <>
      {isVerified && (
        <View style={styles.successContainer}>
          <CheckCircleIcon
            size={theme.icon.sizes.md}
            color={theme.colors.status.success.icon}
            weight={theme.icon.weights.regular}
          />
          <Text style={styles.successTitle}>{COPY.verified.title}</Text>
          <Text style={styles.bannerText}>{COPY.verified.body}</Text>
        </View>
      )}

      {showPendingBanner && (
        <View style={styles.pendingContainer}>
          <CheckCircleIcon
            size={theme.icon.sizes.md}
            color={theme.colors.interactive.active}
            weight={theme.icon.weights.regular}
          />
          <Text style={styles.pendingTitle}>{COPY.pending.title}</Text>
          <Text style={styles.bannerText}>{COPY.pending.body}</Text>
        </View>
      )}

      {showOnHoldBanner && (
        <View style={styles.warningContainer}>
          <ClockCountdownIcon
            size={theme.icon.sizes.md}
            color={theme.colors.status.warning.icon}
            weight={theme.icon.weights.regular}
          />
          <Text style={styles.warningTitle}>{COPY.onHold.title}</Text>
          <Text style={styles.bannerText}>{COPY.onHold.body}</Text>
        </View>
      )}

      {showRejectedBanner && (
        <View style={styles.rejectedContainer}>
          <WarningCircleIcon
            size={theme.icon.sizes.md}
            color={theme.colors.status.error.icon}
            weight={theme.icon.weights.regular}
          />
          <Text style={styles.rejectedTitle}>{COPY.rejected.title}</Text>
          <Text style={styles.bannerText}>{COPY.rejected.body}</Text>
          <RejectionReasons labels={rejectionLabels} />
        </View>
      )}

      {showRetryBanner && (
        <View style={styles.warningContainer}>
          <ArrowCounterClockwiseIcon
            size={theme.icon.sizes.md}
            color={theme.colors.status.warning.icon}
            weight={theme.icon.weights.regular}
          />
          <Text style={styles.warningTitle}>{COPY.retry.title}</Text>
          <Text style={styles.bannerText}>{COPY.retry.body}</Text>
          <RejectionReasons labels={rejectionLabels} />
        </View>
      )}
    </>
  );
}

function RejectionReasons({ labels }: { labels?: string[] | null }) {
  const styles = useThemedStyles((theme) => ({
    rejectionReasons: {
      marginTop: theme.spacing.sm,
      width: '100%',
    },
    reasonsLabel: {
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.muted,
      textTransform: 'uppercase',
      marginTop: theme.spacing.sm,
    },
    reasonItem: {
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.secondary,
      marginTop: theme.spacing.xs,
    },
  }));
  if (!labels || labels.length === 0) return null;

  return (
    <View style={styles.rejectionReasons}>
      <Text style={styles.reasonsLabel}>Reasons:</Text>
      {labels.map((label, index) => (
        <Text key={index} style={styles.reasonItem}>
          {'\u2022'} {label}
        </Text>
      ))}
    </View>
  );
}

import React from 'react';
import { View, Text } from 'react-native';
import {
  CheckCircleIcon,
  WarningCircleIcon,
  ClockCountdownIcon,
  ArrowCounterClockwiseIcon,
} from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../../contexts/index';

interface StatusBannersProps {
  isVerified: boolean;
  showPendingBanner: boolean;
  showOnHoldBanner: boolean;
  showRejectedBanner: boolean;
  showRetryBanner: boolean;
  rejectionLabels?: string[] | null;
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
}: StatusBannersProps) {
  const theme = useAppTheme();
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

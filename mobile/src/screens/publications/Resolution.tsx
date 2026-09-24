import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import {
  BALLOT_CHOICES,
  PUBLICATION_COPY,
  RESOLUTION_KIND_LABELS,
  describeCount,
  describeTurnout,
  formatDateTime,
  useResolutionStatus,
} from '@ledova/shared';
import type { BallotChoice, Publication, ResolutionStatus } from '@ledova/shared';
import { useThemedStyles } from '../../contexts';

function statusLabel(status: ResolutionStatus, closesAt: string | null) {
  if (status === 'upcoming') return PUBLICATION_COPY.NOT_OPEN_YET;
  if (status === 'open') return `${PUBLICATION_COPY.OPEN_UNTIL} ${formatDateTime(closesAt)}`;
  return PUBLICATION_COPY.CLOSED;
}

export function Resolution({
  publication,
  onCast,
  isCasting,
  castError,
}: {
  publication: Publication;
  onCast: (uuid: string, choice: BallotChoice) => void;
  isCasting: boolean;
  castError: string | undefined;
}) {
  const styles = useThemedStyles((theme) => ({
    box: {
      marginTop: theme.spacing.sm,
      padding: theme.spacing.sm,
      borderRadius: theme.borderRadius.sm,
      backgroundColor: theme.colors.surface.tertiary,
    },
    label: { fontSize: theme.fontSize.xs, color: theme.colors.text.muted, textTransform: 'uppercase' as const },
    question: { fontSize: theme.fontSize.sm, color: theme.colors.text.primary, marginTop: 2 },
    detail: { fontSize: theme.fontSize.xs, color: theme.colors.text.muted, marginTop: 2 },
    status: {
      fontSize: theme.fontSize.xs,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.text.secondary,
      marginTop: theme.spacing.xs,
    },
    voted: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.text.primary,
      marginTop: theme.spacing.sm,
    },
    choices: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: theme.spacing.xs,
      marginTop: theme.spacing.sm,
    },
    choice: {
      paddingVertical: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
      borderRadius: theme.borderRadius.sm,
      borderWidth: 1,
      borderColor: theme.colors.interactive.active,
    },
    confirm: {
      paddingVertical: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
      borderRadius: theme.borderRadius.sm,
      backgroundColor: theme.colors.interactive.active,
    },
    buttonLabel: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.text.primary,
    },
    warning: { fontSize: theme.fontSize.xs, color: theme.colors.status.warning.text, marginTop: 2 },
    error: { fontSize: theme.fontSize.sm, color: theme.colors.status.error.text, marginTop: theme.spacing.sm },
    carried: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.status.success.text,
      marginTop: 2,
    },
    notCarried: {
      fontSize: theme.fontSize.sm,
      fontWeight: theme.fontWeight.semibold,
      color: theme.colors.status.error.text,
      marginTop: 2,
    },
    result: { marginTop: theme.spacing.sm },
  }));
  const [choosing, setChoosing] = useState<BallotChoice | null>(null);
  const status = useResolutionStatus(publication);
  if (status === null) return null;
  const mayVote = status === 'open' && publication.ballotOutstanding;
  const result = publication.result;

  return (
    <View style={styles.box}>
      <Text style={styles.label}>{PUBLICATION_COPY.QUESTION_LABEL}</Text>
      <Text style={styles.question}>{publication.question}</Text>
      <Text style={styles.detail}>
        {publication.resolutionKind ? `${RESOLUTION_KIND_LABELS[publication.resolutionKind]} · ` : ''}
        {PUBLICATION_COPY.BASIS}
      </Text>
      <Text style={styles.detail}>
        {`${PUBLICATION_COPY.WINDOW_LABEL} ${formatDateTime(publication.opensAt)} ${PUBLICATION_COPY.WINDOW_TO} ${formatDateTime(publication.closesAt)}`}
      </Text>
      <Text style={styles.status}>{statusLabel(status, publication.closesAt)}</Text>

      {publication.myBallot && (
        <>
          <Text style={styles.voted}>{PUBLICATION_COPY.YOU_VOTED[publication.myBallot.choice]}</Text>
          {publication.myBallot.staffEntered && <Text style={styles.detail}>{PUBLICATION_COPY.STAFF_ENTERED}</Text>}
          {mayVote && <Text style={styles.detail}>{PUBLICATION_COPY.BALLOT_OUTSTANDING}</Text>}
        </>
      )}

      {mayVote && choosing === null && (
        <View style={styles.choices}>
          {BALLOT_CHOICES.map((choice) => (
            <TouchableOpacity
              key={choice}
              style={styles.choice}
              onPress={() => setChoosing(choice)}
              accessibilityRole="button"
              accessibilityLabel={`${PUBLICATION_COPY.CHOICES[choice]}: ${publication.title}`}
            >
              <Text style={styles.buttonLabel}>{PUBLICATION_COPY.CHOICES[choice]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {mayVote && choosing !== null && (
        <View>
          <Text style={styles.voted}>{`${PUBLICATION_COPY.CONFIRM_TITLE} ${PUBLICATION_COPY.CHOICES[choosing]}`}</Text>
          <Text style={styles.warning}>{PUBLICATION_COPY.CONFIRM_BODY}</Text>
          <View style={styles.choices}>
            <TouchableOpacity
              style={styles.confirm}
              onPress={() => onCast(publication.uuid, choosing)}
              disabled={isCasting}
              accessibilityRole="button"
            >
              <Text style={styles.buttonLabel}>{isCasting ? PUBLICATION_COPY.CASTING : PUBLICATION_COPY.CONFIRM}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.choice}
              onPress={() => setChoosing(null)}
              disabled={isCasting}
              accessibilityRole="button"
            >
              <Text style={styles.buttonLabel}>{PUBLICATION_COPY.CANCEL}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {castError && (
        <Text style={styles.error} accessibilityRole="alert">
          {castError}
        </Text>
      )}

      {status === 'closed' &&
        (result ? (
          <View style={styles.result}>
            <Text style={styles.label}>{PUBLICATION_COPY.RESULT_LABEL}</Text>
            <Text style={result.carried ? styles.carried : styles.notCarried}>
              {result.carried ? PUBLICATION_COPY.CARRIED : PUBLICATION_COPY.NOT_CARRIED}
            </Text>
            {BALLOT_CHOICES.map((choice) => (
              <Text key={choice} style={styles.detail}>
                {`${PUBLICATION_COPY.CHOICES[choice]}: ${describeCount(result[choice])}`}
              </Text>
            ))}
            <Text style={styles.detail}>{`${PUBLICATION_COPY.TURNOUT_LABEL}: ${describeTurnout(result)}`}</Text>
          </View>
        ) : (
          <Text style={styles.detail}>{PUBLICATION_COPY.RESULT_PENDING}</Text>
        ))}
    </View>
  );
}

import { useState } from 'react';
import { View, Text } from 'react-native';
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
import { Action, Row, Rows } from '../../components/Ledger';
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
    box: { gap: 8, paddingVertical: theme.spacing.smd },
    label: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.muted,
      textTransform: 'uppercase' as const,
    },
    question: { fontFamily: theme.fontFamily.regular, fontSize: 15, lineHeight: 23, color: theme.colors.text.primary },
    detail: { fontFamily: theme.fontFamily.regular, fontSize: 13, lineHeight: 20, color: theme.colors.text.muted },
    status: { fontFamily: theme.fontFamily.semibold, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
    choices: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 6 },
    confirmation: {
      gap: 10,
      paddingTop: theme.spacing.smd,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border.subtle,
    },
    error: {
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.status.error.text,
    },
    result: { marginTop: theme.spacing.smd, gap: 8 },
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
      <Text
        style={styles.detail}
      >{`${PUBLICATION_COPY.WINDOW_LABEL} ${formatDateTime(publication.opensAt)} ${PUBLICATION_COPY.WINDOW_TO} ${formatDateTime(publication.closesAt)}`}</Text>
      <Text style={styles.status}>{statusLabel(status, publication.closesAt)}</Text>
      {publication.myBallot && (
        <>
          <Text style={styles.status}>{PUBLICATION_COPY.YOU_VOTED[publication.myBallot.choice]}</Text>
          {publication.myBallot.staffEntered && <Text style={styles.detail}>{PUBLICATION_COPY.STAFF_ENTERED}</Text>}
          {mayVote && <Text style={styles.detail}>{PUBLICATION_COPY.BALLOT_OUTSTANDING}</Text>}
        </>
      )}
      {mayVote && choosing === null && (
        <View style={styles.choices}>
          {BALLOT_CHOICES.map((choice) => (
            <Action
              key={choice}
              label={PUBLICATION_COPY.CHOICES[choice]}
              accessibilityLabel={`${PUBLICATION_COPY.CHOICES[choice]}: ${publication.title}`}
              onPress={() => setChoosing(choice)}
            />
          ))}
        </View>
      )}
      {mayVote && choosing !== null && (
        <View style={styles.confirmation}>
          <Text style={styles.status}>{`${PUBLICATION_COPY.CONFIRM_TITLE} ${PUBLICATION_COPY.CHOICES[choosing]}`}</Text>
          <Text style={styles.detail}>{PUBLICATION_COPY.CONFIRM_BODY}</Text>
          <View style={styles.choices}>
            <Action
              label={isCasting ? PUBLICATION_COPY.CASTING : PUBLICATION_COPY.CONFIRM}
              onPress={() => onCast(publication.uuid, choosing)}
              disabled={isCasting}
              primary
            />
            <Action label={PUBLICATION_COPY.CANCEL} onPress={() => setChoosing(null)} disabled={isCasting} />
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
            <Text style={styles.status}>
              {result.carried ? PUBLICATION_COPY.CARRIED : PUBLICATION_COPY.NOT_CARRIED}
            </Text>
            <Rows>
              {BALLOT_CHOICES.map((choice) => (
                <Row key={choice} label={PUBLICATION_COPY.CHOICES[choice]}>
                  {describeCount(result[choice])}
                </Row>
              ))}
              <Row label={PUBLICATION_COPY.TURNOUT_LABEL}>{describeTurnout(result)}</Row>
            </Rows>
          </View>
        ) : (
          <Text style={styles.detail}>{PUBLICATION_COPY.RESULT_PENDING}</Text>
        ))}
    </View>
  );
}

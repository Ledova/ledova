import { Text, View } from 'react-native';
import {
  BALLOT_CHOICES,
  PUBLICATION_COPY,
  PUBLICATION_KIND_LABELS,
  RESOLUTION_KIND_LABELS,
  describeCount,
  describeRate,
  describeTurnout,
  formatDate,
  formatDateTime,
  useResolutionStatus,
  type Publication,
} from '@ledova/shared';
import { Action, Row, Rows, Section } from '../../components/Ledger';
import { useCompanyStyles } from '../company-register/styles';

function ResolutionRecord({ publication }: { publication: Publication }) {
  const styles = useCompanyStyles();
  const status = useResolutionStatus(publication);
  if (status === null) return null;
  return (
    <View style={styles.group}>
      <Text style={styles.text}>{publication.question}</Text>
      <Text style={styles.muted}>
        {publication.resolutionKind && `${RESOLUTION_KIND_LABELS[publication.resolutionKind]} · `}
        {PUBLICATION_COPY.BASIS}
      </Text>
      <Rows>
        <Row label="Voting opens">{formatDateTime(publication.opensAt)}</Row>
        <Row label="Voting closes">{formatDateTime(publication.closesAt)}</Row>
      </Rows>
      <Text style={styles.heading}>
        {status === 'upcoming'
          ? PUBLICATION_COPY.NOT_OPEN_YET
          : status === 'open'
            ? 'Voting is open'
            : PUBLICATION_COPY.CLOSED}
      </Text>
      {publication.result ? (
        <View style={styles.group}>
          <Text style={styles.heading}>
            {publication.result.carried ? PUBLICATION_COPY.CARRIED : PUBLICATION_COPY.NOT_CARRIED}
          </Text>
          <Rows>
            {BALLOT_CHOICES.map((choice) => (
              <Row key={choice} label={PUBLICATION_COPY.CHOICES[choice]}>
                {describeCount(publication.result![choice])}
              </Row>
            ))}
            <Row label="Eligible">{describeCount(publication.result.eligible)}</Row>
            <Row label={PUBLICATION_COPY.TURNOUT_LABEL}>{describeTurnout(publication.result)}</Row>
          </Rows>
        </View>
      ) : (
        status === 'closed' && <Text style={styles.muted}>{PUBLICATION_COPY.RESULT_PENDING}</Text>
      )}
    </View>
  );
}

export function PublicationRecord({
  publication,
  open,
  opening,
  blocked,
}: {
  publication: Publication;
  open: () => void;
  opening: boolean;
  blocked: boolean;
}) {
  const styles = useCompanyStyles();
  return (
    <Section title={publication.title}>
      <Text style={styles.muted}>{PUBLICATION_KIND_LABELS[publication.kind]}</Text>
      <Text style={styles.text}>{publication.companyName}</Text>
      <Text style={styles.muted}>
        {publication.tokenName} ({publication.tokenSymbol})
      </Text>
      <Rows>
        <Row label={PUBLICATION_COPY.RECORD_DATE_LABEL}>{formatDate(publication.recordDate)}</Row>
        <Row label="Published">{formatDate(publication.createdAt)}</Row>
      </Rows>
      <ResolutionRecord publication={publication} />
      {publication.kind === 'distribution' && (
        <Rows>
          <Row label="Rate per share">{describeRate(publication)}</Row>
          {publication.declaredOn && <Row label="Declared">{formatDate(publication.declaredOn)}</Row>}
          {publication.paymentDate && <Row label="Payment date">{formatDate(publication.paymentDate)}</Row>}
        </Rows>
      )}
      <Action
        label={opening ? PUBLICATION_COPY.OPENING : PUBLICATION_COPY.OPEN}
        accessibilityLabel={`${PUBLICATION_COPY.OPEN}: ${publication.title}`}
        onPress={open}
        disabled={opening || blocked}
      />
    </Section>
  );
}

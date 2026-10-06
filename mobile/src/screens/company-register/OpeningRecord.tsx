import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  formatDate,
  formatDateTime,
  formatRegisterChanges,
  REGISTER_OPENING_COPY as COPY,
  REGISTER_OPENING_DECISIONS,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterOpening,
  type RegisterOpeningDecisionPreview,
  type RegisterStep,
} from '@ledova/shared';
import { Row, Rows } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { memberLabels, shareCount } from './openingMembers';
import { RegisterCopy } from './RegisterCopy';
import { RegisterDecision } from './RegisterDecision';
import { useCompanyStyles } from './styles';

const DECISION_KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];
const DECIDED: Record<RegisterDecisionKind, string> = {
  approve: COPY.STAGES.approved,
  apply: COPY.STAGES.applied,
  reject: COPY.STAGES.rejected,
};

const NO_BOUNDARY = 'No boundary captured';

function OpeningPreview({
  kind,
  preview,
  labels,
}: {
  kind: RegisterDecisionKind;
  preview: RegisterOpeningDecisionPreview;
  labels: Map<string, string>;
}) {
  const styles = useCompanyStyles();
  return (
    <>
      {kind !== 'reject' && <Text style={styles.text}>{COPY.BOUNDARY_NOTE}</Text>}
      {kind === 'apply' && <Text style={styles.text}>{COPY.HOLDINGS_NOTE}</Text>}
      {preview.effectiveOn && (
        <Rows>
          <Row label="Effective date">{formatDate(preview.effectiveOn)}</Row>
        </Rows>
      )}
      {preview.changes.length > 0 ? (
        <>
          <Text style={styles.heading}>The register’s first entry</Text>
          {formatRegisterChanges(
            preview.changes.map(({ member, shares }) => ({ member, shares, name: labels.get(member) })),
          ).map((line, index) => (
            <Text key={index} style={styles.text}>
              {line}
            </Text>
          ))}
        </>
      ) : (
        !!preview.effectiveOn && <Text style={styles.text}>{COPY.NO_HOLDINGS}</Text>
      )}
    </>
  );
}

export function OpeningRecord({
  proposal,
  epoch,
  steps,
  last,
  onSettled,
}: {
  proposal: RegisterOpening;
  epoch: number;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  last: boolean;
  onSettled: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const kinds: RegisterDecisionKind[] = proposal.providedBy === 'company' ? DECISION_KINDS : ['reject'];
  const stage = COPY.STAGES[proposal.stage] ?? proposal.stage;
  const boundary = proposal.boundarySummary;
  const holdings = boundary?.holdings ?? [];
  const labels = memberLabels(
    holdings.map(({ member }) => member),
    new Map(holdings.flatMap(({ member, memberName }) => (member && memberName ? [[member, memberName]] : []))),
  );
  const prepared = formatDateTime(proposal.createdAt);
  const at = boundary ? `at block ${boundary.blockNumber}` : `with ${NO_BOUNDARY.toLowerCase()}`;
  const description = `${stage.toLowerCase()} opening ${at}, prepared on ${prepared}`;
  return (
    <View style={[styles.entry, last && styles.lastEntry]}>
      <Text style={styles.heading}>
        {stage} · {boundary ? COPY.BOUNDARY_BLOCK(boundary.blockNumber, formatDate(boundary.date)) : NO_BOUNDARY}
      </Text>
      <Text style={styles.muted}>
        {proposal.providedBy === 'company' ? COPY.PROVIDED_BY_COMPANY : COPY.STAFF_VERIFIED}
      </Text>
      <Rows>
        {proposal.preparedByName !== null && (
          <Row label="Prepared by">{proposal.preparedByName || 'Name not recorded'}</Row>
        )}
        <Row label="Prepared on">{prepared}</Row>
        {proposal.decisions.map((decision) => (
          <Row key={decision.uuid} label={DECIDED[decision.kind]}>
            {[decision.decidedByName, formatDateTime(decision.decidedAt)].filter(Boolean).join(' · ')}
          </Row>
        ))}
        {proposal.decisions.length === 0 && proposal.reviewedAt && (
          <Row label="Decided on">{formatDateTime(proposal.reviewedAt)}</Row>
        )}
        {!!proposal.rejectionReason && <Row label="Rejection reason">{proposal.rejectionReason}</Row>}
        <Row label={COPY.AUTHORITY}>{COPY.AUTHORITIES[proposal.authority]}</Row>
        {!!proposal.approvingDirector && <Row label={COPY.APPROVING_DIRECTOR}>{proposal.approvingDirector}</Row>}
        <Row label={COPY.AUTHORITY_REFERENCE}>{proposal.authorityReference}</Row>
        <Row label={COPY.REASON}>{proposal.reason}</Row>
      </Rows>
      <Text style={styles.heading}>{COPY.HOLDINGS}</Text>
      {!boundary ? (
        <Text style={styles.muted}>No boundary was captured for this opening, so it lists no holdings.</Text>
      ) : holdings.length === 0 ? (
        <Text style={styles.muted}>{COPY.NO_HOLDINGS}</Text>
      ) : (
        holdings.map((row) => (
          <View key={row.address}>
            <Text style={styles.text}>
              {(row.member && labels.get(row.member)) || COPY.MEMBER} · {shareCount(row.shares)}
            </Text>
            <Text selectable style={styles.muted}>
              {row.address}
            </Text>
          </View>
        ))
      )}
      <RegisterCopy
        label={COPY.DOWNLOAD}
        accessibilityLabel={`${COPY.DOWNLOAD} of the ${description}`}
        filename={`authority-${proposal.uuid}`}
        epoch={epoch}
        read={() =>
          apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENING_FILE(proposal.uuid), {
            responseType: 'arraybuffer',
            ledovaSessionEpoch: epoch,
          })
        }
      />
      {proposal.status === 'submitted' && steps && (
        <View style={styles.choices}>
          {kinds.map((kind) => {
            const appointment = steps[kind];
            return (
              appointment && (
                <RegisterDecision
                  key={kind}
                  family={REGISTER_OPENING_DECISIONS}
                  copy={COPY}
                  noun="opening"
                  proposal={proposal}
                  kind={kind}
                  appointment={appointment.uuid}
                  epoch={epoch}
                  description={description}
                  onSettled={onSettled}
                  onRefused={onSettled}
                >
                  {(preview) => <OpeningPreview kind={kind} preview={preview} labels={labels} />}
                </RegisterDecision>
              )
            );
          })}
        </View>
      )}
    </View>
  );
}

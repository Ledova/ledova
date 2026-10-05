import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  formatDate,
  formatDateTime,
  formatRegisterChanges,
  REGISTER_CORRECTION_COPY as COPY,
  REGISTER_CORRECTION_DECISIONS,
  type OwnCompanyAppointment,
  type RegisterCorrection,
  type RegisterCorrectionDecisionPreview,
  type RegisterDecisionKind,
  type RegisterEntry,
  type RegisterStep,
} from '@ledova/shared';
import { Row, Rows } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { RegisterCopy } from './RegisterCopy';
import { RegisterDecision } from './RegisterDecision';
import { useCompanyStyles } from './styles';

const DECISION_KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];
const DECIDED: Record<RegisterDecisionKind, string> = {
  approve: COPY.STAGES.approved,
  apply: COPY.STAGES.applied,
  reject: COPY.STAGES.rejected,
};

function Changes({ title, note, lines }: { title: string; note?: string; lines: string[] }) {
  const styles = useCompanyStyles();
  return (
    <>
      <Text style={styles.heading}>{title}</Text>
      {!!note && <Text style={styles.muted}>{note}</Text>}
      {lines.map((line, index) => (
        <Text key={index} style={styles.text}>
          {line}
        </Text>
      ))}
    </>
  );
}

function CorrectionPreview({
  kind,
  preview,
  corrected,
}: {
  kind: RegisterDecisionKind;
  preview: RegisterCorrectionDecisionPreview;
  corrected: RegisterEntry;
}) {
  const styles = useCompanyStyles();
  return (
    <>
      {kind === 'apply' && <Text style={styles.text}>{COPY.COMPENSATION_NOTE}</Text>}
      <Rows>
        <Row label="Register sequence">{preview.registerSequence}</Row>
        <Row label={COPY.EFFECTIVE_ON}>{formatDate(preview.effectiveOn)}</Row>
      </Rows>
      <Changes
        title={COPY.ORIGINAL_CHANGES}
        lines={formatRegisterChanges(preview.originalChanges, corrected.changes)}
      />
      <Changes title={COPY.COMPENSATING_CHANGES} lines={formatRegisterChanges(preview.changes, corrected.changes)} />
    </>
  );
}

export function CorrectionRecord({
  proposal,
  corrected,
  epoch,
  steps,
  last,
  onSettled,
}: {
  proposal: RegisterCorrection;
  corrected: RegisterEntry;
  epoch: number;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  last: boolean;
  onSettled: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const kinds: RegisterDecisionKind[] = proposal.providedBy === 'company' ? DECISION_KINDS : ['reject'];
  const stage = COPY.STAGES[proposal.stage] ?? proposal.stage;
  const description = `${stage.toLowerCase()} correction of entry ${corrected.sequence}`;
  const entry = `Entry ${corrected.sequence} · ${COPY.ENTRY_KINDS[corrected.kind]}`;
  return (
    <View style={[styles.entry, last && styles.lastEntry]}>
      <Text style={styles.heading}>
        {stage} · entry {corrected.sequence}
      </Text>
      <Text style={styles.muted}>
        {proposal.providedBy === 'company' ? COPY.PROVIDED_BY_COMPANY : COPY.STAFF_VERIFIED}
      </Text>
      <Rows>
        {proposal.preparedByName !== null && (
          <Row label="Prepared by">{proposal.preparedByName || 'Name not recorded'}</Row>
        )}
        <Row label="Prepared on">{formatDateTime(proposal.createdAt)}</Row>
        <Row label={COPY.EFFECTIVE_ON}>{formatDate(proposal.effectiveOn)}</Row>
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
      <Changes
        title={COPY.ORIGINAL_CHANGES}
        note={`${entry} · effective ${formatDate(corrected.effectiveOn)}`}
        lines={formatRegisterChanges(corrected.changes)}
      />
      <Changes title={COPY.COMPENSATING_CHANGES} lines={formatRegisterChanges(proposal.changes, corrected.changes)} />
      <RegisterCopy
        label={COPY.DOWNLOAD}
        accessibilityLabel={`${COPY.DOWNLOAD} of the ${description}`}
        filename={`authority-${proposal.uuid}`}
        epoch={epoch}
        read={() =>
          apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_CORRECTION_FILE(proposal.uuid), {
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
                  family={REGISTER_CORRECTION_DECISIONS}
                  copy={COPY}
                  noun="correction"
                  proposal={proposal}
                  kind={kind}
                  appointment={appointment.uuid}
                  epoch={epoch}
                  description={description}
                  onSettled={onSettled}
                  onRefused={onSettled}
                >
                  {(preview) => <CorrectionPreview kind={kind} preview={preview} corrected={corrected} />}
                </RegisterDecision>
              )
            );
          })}
        </View>
      )}
    </View>
  );
}

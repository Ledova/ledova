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

function Changes({ title, lines }: { title: string; lines: string[] }) {
  const styles = useCompanyStyles();
  return (
    <>
      <Text style={styles.heading}>{title}</Text>
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
  visible = true,
  guard,
  onHeldChange,
}: {
  proposal: RegisterCorrection;
  corrected: RegisterEntry;
  visible?: boolean;
  guard?: () => void;
  onHeldChange?: (key: string, held: boolean) => void;
  epoch: number;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  last: boolean;
  onSettled: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const kinds: RegisterDecisionKind[] = proposal.providedBy === 'company' ? DECISION_KINDS : ['reject'];
  const stage = COPY.STAGES[proposal.stage] ?? proposal.stage;
  const effective = formatDate(proposal.effectiveOn);
  const prepared = formatDateTime(proposal.createdAt);
  const description = `${stage.toLowerCase()} correction of entry ${corrected.sequence}, effective ${effective}, prepared on ${prepared}`;
  return (
    <View style={visible ? [styles.entry, last && styles.lastEntry] : undefined}>
      {visible && (
        <>
          <Text style={styles.heading}>
            {stage} · entry {corrected.sequence} · effective {effective}
          </Text>
          <Text style={styles.muted}>
            {proposal.providedBy === 'company' ? COPY.PROVIDED_BY_COMPANY : COPY.STAFF_VERIFIED}
          </Text>
          <Rows>
            <Row label="Corrects">
              Entry {corrected.sequence} · {COPY.ENTRY_KINDS[corrected.kind]}
            </Row>
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
          <Changes
            title={COPY.COMPENSATING_CHANGES}
            lines={formatRegisterChanges(proposal.changes, corrected.changes)}
          />
          <RegisterCopy
            label={COPY.DOWNLOAD}
            accessibilityLabel={`${COPY.DOWNLOAD} of the ${description}`}
            filename={`authority-${proposal.uuid}`}
            epoch={epoch}
            guard={guard}
            read={() =>
              apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_CORRECTION_FILE(proposal.uuid), {
                responseType: 'arraybuffer',
                ledovaSessionEpoch: epoch,
                ledovaSubmissionGuard: guard,
              })
            }
          />
        </>
      )}
      <View style={styles.choices}>
        {kinds.map((kind) => {
          const appointment = steps?.[kind];
          return (
            <RegisterDecision
              key={kind}
              family={REGISTER_CORRECTION_DECISIONS}
              copy={COPY}
              noun="correction"
              proposal={proposal}
              kind={kind}
              appointment={appointment?.uuid}
              visible={visible}
              enabled={proposal.status === 'submitted'}
              readGuard={guard}
              newEffectGuard={guard}
              onHeldChange={onHeldChange}
              epoch={epoch}
              description={description}
              onSettled={onSettled}
              onRefused={onSettled}
            >
              {(preview) => <CorrectionPreview kind={kind} preview={preview} corrected={corrected} />}
            </RegisterDecision>
          );
        })}
      </View>
    </View>
  );
}

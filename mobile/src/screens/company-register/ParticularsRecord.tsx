import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  formatDate,
  formatDateTime,
  REGISTER_PARTICULARS_COPY as COPY,
  REGISTER_PARTICULARS_DECISIONS,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterParticularsChange,
  type RegisterParticularsChangeDecisionPreview,
  type RegisterStep,
} from '@ledova/shared';
import { Row, Rows } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { RegisterCopy } from './RegisterCopy';
import { RegisterDecision } from './RegisterDecision';
import { useCompanyStyles } from './styles';

type Particulars = { name: string; residentialAddress: string; asAt: string };

const DECISION_KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];
const DECIDED: Record<RegisterDecisionKind, string> = {
  approve: COPY.STAGES.approved,
  apply: COPY.STAGES.applied,
  reject: COPY.STAGES.rejected,
};

function particularsRows({ name, residentialAddress, asAt }: Particulars) {
  return (
    <>
      <Row label={COPY.NAME}>{name}</Row>
      <Row label={COPY.RESIDENTIAL_ADDRESS}>{residentialAddress}</Row>
      <Row label={COPY.AS_AT}>{formatDate(asAt)}</Row>
    </>
  );
}

function ParticularsPreview({
  kind,
  preview,
}: {
  kind: RegisterDecisionKind;
  preview: RegisterParticularsChangeDecisionPreview;
}) {
  const styles = useCompanyStyles();
  return (
    <>
      {kind !== 'reject' && <Text style={styles.text}>{COPY.PRECEDENCE_NOTE}</Text>}
      <Text style={styles.heading}>{COPY.CURRENT_PARTICULARS}</Text>
      {preview.current ? (
        <Rows>{particularsRows(preview.current)}</Rows>
      ) : (
        <Text style={styles.text}>{COPY.NO_CURRENT_PARTICULARS}</Text>
      )}
      <Text style={styles.heading}>{COPY.PROPOSED_PARTICULARS}</Text>
      <Rows>{particularsRows(preview)}</Rows>
    </>
  );
}

export function ParticularsRecord({
  change,
  member,
  epoch,
  steps,
  last,
  onSettled,
}: {
  change: RegisterParticularsChange;
  member: string;
  epoch: number;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  last: boolean;
  onSettled: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const stage = COPY.STAGES[change.stage] ?? change.stage;
  const prepared = formatDateTime(change.createdAt);
  const description = `${stage.toLowerCase()} particulars change for ${member}, as at ${formatDate(change.asAt)}, prepared on ${prepared}`;
  return (
    <View style={[styles.entry, last && styles.lastEntry]}>
      <Text style={styles.heading}>
        {stage} · {member}
      </Text>
      <Text style={styles.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
      <Rows>
        {particularsRows(change)}
        <Row label={COPY.REASON}>{change.reason}</Row>
        <Row label="Prepared by">{change.preparedByName || 'Name not recorded'}</Row>
        <Row label="Prepared on">{prepared}</Row>
        {change.decisions.map((decision) => (
          <Row key={decision.uuid} label={DECIDED[decision.kind]}>
            {[decision.decidedByName, formatDateTime(decision.decidedAt)].filter(Boolean).join(' · ')}
          </Row>
        ))}
        {!!change.rejectionReason && <Row label="Rejection reason">{change.rejectionReason}</Row>}
      </Rows>
      <RegisterCopy
        label={COPY.DOWNLOAD}
        accessibilityLabel={`${COPY.DOWNLOAD} of the ${description}`}
        filename={`supporting-${change.uuid}`}
        epoch={epoch}
        read={() =>
          apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGE_FILE(change.uuid), {
            responseType: 'arraybuffer',
            ledovaSessionEpoch: epoch,
          })
        }
      />
      {change.status === 'submitted' && steps && (
        <View style={styles.choices}>
          {DECISION_KINDS.map((kind) => {
            const appointment = steps[kind];
            return (
              appointment && (
                <RegisterDecision
                  key={kind}
                  family={REGISTER_PARTICULARS_DECISIONS}
                  copy={COPY}
                  noun="particulars change"
                  proposal={change}
                  kind={kind}
                  appointment={appointment.uuid}
                  epoch={epoch}
                  description={description}
                  onSettled={onSettled}
                  onRefused={onSettled}
                >
                  {(preview) => <ParticularsPreview kind={kind} preview={preview} />}
                </RegisterDecision>
              )
            );
          })}
        </View>
      )}
    </View>
  );
}

import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  formatDate,
  formatDateTime,
  formatShareCount,
  REGISTER_COPY,
  REGISTER_IMPORT_COPY,
  REGISTER_IMPORT_DECISIONS,
  registerImportTotals,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterImport,
  type RegisterImportDecisionPreview,
  type RegisterStep,
} from '@ledova/shared';
import { Row, Rows } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { RegisterCopy } from './RegisterCopy';
import { RegisterDecision } from './RegisterDecision';
import { useCompanyStyles } from './styles';

const DECISION_KINDS: RegisterDecisionKind[] = ['approve', 'apply', 'reject'];
const DECIDED: Record<RegisterDecisionKind, string> = {
  approve: REGISTER_IMPORT_COPY.STAGES.approved,
  apply: REGISTER_IMPORT_COPY.STAGES.applied,
  reject: REGISTER_IMPORT_COPY.STAGES.rejected,
};

function ImportPreview({ kind, preview }: { kind: RegisterDecisionKind; preview: RegisterImportDecisionPreview }) {
  const styles = useCompanyStyles();
  return (
    <>
      {kind === 'apply' && preview.opensRegister && (
        <Text style={styles.text}>{REGISTER_IMPORT_COPY.NOT_ON_CHAIN_NOTE}</Text>
      )}
      {preview.statedTotal !== null && preview.statedMemberCount !== null && (
        <Text style={styles.text}>
          {REGISTER_IMPORT_COPY.STATED_FIGURES(formatShareCount(preview.statedTotal), preview.statedMemberCount)}
        </Text>
      )}
      <Text style={styles.text}>
        {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(preview.importedTotal), preview.importedMemberCount)}
      </Text>
      <Text style={styles.heading}>Members compared with the stored register</Text>
      {preview.comparison.map((row, index) => (
        <View key={row.member} style={[styles.entry, index === preview.comparison.length - 1 && styles.lastEntry]}>
          <Rows>
            <Row label="Imported name">{row.name ?? 'Not in the import'}</Row>
            <Row label="Imported shares">
              {row.imported === null ? 'Not in the import' : formatShareCount(row.imported)}
            </Row>
            <Row label="Stored shares">{row.stored === null ? 'Not stored' : formatShareCount(row.stored)}</Row>
            <Row label="Imported date entered">{row.importedEnteredOn ?? 'Not in the import'}</Row>
            <Row label="Stored date entered">{row.enteredOn ?? 'Not stored'}</Row>
            <Row label="Live name">{row.liveName || 'No live identity'}</Row>
            {!!row.liveAddress && <Row label="Live address">{row.liveAddress}</Row>}
            <Row label="Wallets">{row.wallets.length > 0 ? row.wallets.join(', ') : REGISTER_COPY.NO_WALLET}</Row>
          </Rows>
        </View>
      ))}
    </>
  );
}

export function ImportRecord({
  proposal,
  epoch,
  steps,
  last,
  onSettled,
  onRefused,
}: {
  proposal: RegisterImport;
  epoch: number;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  last: boolean;
  onSettled: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const totals = registerImportTotals(proposal.members);
  const kinds: RegisterDecisionKind[] = proposal.providedBy === 'company' ? DECISION_KINDS : ['reject'];
  const stage = REGISTER_IMPORT_COPY.STAGES[proposal.stage] ?? proposal.stage;
  const prepared = formatDateTime(proposal.createdAt);
  const description = `${stage.toLowerCase()} import as at ${formatDate(proposal.asAt)}, prepared on ${prepared}`;
  return (
    <View style={[styles.entry, last && styles.lastEntry]}>
      <Text style={styles.heading}>
        {stage} · as at {formatDate(proposal.asAt)}
      </Text>
      <Text style={styles.muted}>
        {proposal.providedBy === 'company'
          ? REGISTER_IMPORT_COPY.PROVIDED_BY_COMPANY
          : REGISTER_IMPORT_COPY.STAFF_VERIFIED}
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
      </Rows>
      {proposal.asicIssuedTotal !== null && proposal.asicMemberCount !== null && (
        <Text style={styles.text}>
          {REGISTER_IMPORT_COPY.STATED_FIGURES(formatShareCount(proposal.asicIssuedTotal), proposal.asicMemberCount)}
        </Text>
      )}
      <Text style={styles.text}>
        {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(totals.total), totals.count)}
      </Text>
      <RegisterCopy
        label={REGISTER_IMPORT_COPY.DOWNLOAD_REGISTER}
        accessibilityLabel={`${REGISTER_IMPORT_COPY.DOWNLOAD_REGISTER} of the ${description}`}
        filename={`register-${proposal.uuid}`}
        epoch={epoch}
        read={() =>
          apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_FILE(proposal.uuid), {
            responseType: 'arraybuffer',
            ledovaSessionEpoch: epoch,
          })
        }
      />
      {!!proposal.asicSnapshot && (
        <RegisterCopy
          label={REGISTER_IMPORT_COPY.DOWNLOAD_ASIC}
          accessibilityLabel={`${REGISTER_IMPORT_COPY.DOWNLOAD_ASIC} of the ${description}`}
          filename={`asic-extract-${proposal.uuid}`}
          epoch={epoch}
          read={() =>
            apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_ASIC_FILE(proposal.uuid), {
              responseType: 'arraybuffer',
              ledovaSessionEpoch: epoch,
            })
          }
        />
      )}
      {proposal.status === 'submitted' && steps && (
        <View style={styles.choices}>
          {kinds.map((kind) => {
            const appointment = steps[kind];
            return (
              appointment && (
                <RegisterDecision
                  key={kind}
                  family={REGISTER_IMPORT_DECISIONS}
                  copy={REGISTER_IMPORT_COPY}
                  noun="import"
                  proposal={proposal}
                  kind={kind}
                  appointment={appointment.uuid}
                  epoch={epoch}
                  description={description}
                  onSettled={onSettled}
                  onRefused={onRefused}
                >
                  {(preview) => <ImportPreview kind={kind} preview={preview} />}
                </RegisterDecision>
              )
            );
          })}
        </View>
      )}
    </View>
  );
}

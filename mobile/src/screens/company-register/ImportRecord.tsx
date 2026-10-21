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
import { RegisterCopy } from '../../components/register/RegisterCopy';
import { RegisterDecision } from '../../components/register/RegisterDecision';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';

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
      {(preview.statedTotal !== null || preview.statedMemberCount !== null) && (
        <Text style={styles.text}>
          {preview.statedTotal === null
            ? REGISTER_IMPORT_COPY.STATED_COUNT(preview.statedMemberCount!)
            : preview.statedMemberCount === null
              ? REGISTER_IMPORT_COPY.STATED_TOTAL(formatShareCount(preview.statedTotal))
              : REGISTER_IMPORT_COPY.STATED_FIGURES(formatShareCount(preview.statedTotal), preview.statedMemberCount)}
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
  visible = true,
  guard,
  onHeldChange,
}: {
  proposal: RegisterImport;
  visible?: boolean;
  guard?: () => void;
  onHeldChange?: (key: string, held: boolean) => void;
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
    <View style={visible ? [styles.entry, last && styles.lastEntry] : undefined}>
      {visible && (
        <>
          <Text style={styles.heading}>
            {stage} · as at {formatDate(proposal.asAt)}
          </Text>
          <Text style={styles.muted}>
            {proposal.providedBy === 'company'
              ? REGISTER_IMPORT_COPY.PROVIDED_BY_COMPANY
              : REGISTER_IMPORT_COPY.STAFF_VERIFIED}
          </Text>
          <Rows>
            {!!proposal.sourceReference && <Row label="Source records">{proposal.sourceReference}</Row>}
            {!!proposal.correctionOf && <Row label="Corrects opening snapshot">{proposal.correctionOf}</Row>}
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
          {(proposal.asicIssuedTotal !== null || proposal.asicMemberCount !== null) && (
            <Text style={styles.text}>
              {proposal.asicIssuedTotal === null
                ? REGISTER_IMPORT_COPY.STATED_COUNT(proposal.asicMemberCount!)
                : proposal.asicMemberCount === null
                  ? REGISTER_IMPORT_COPY.STATED_TOTAL(formatShareCount(proposal.asicIssuedTotal))
                  : REGISTER_IMPORT_COPY.STATED_FIGURES(
                      formatShareCount(proposal.asicIssuedTotal),
                      proposal.asicMemberCount,
                    )}
            </Text>
          )}
          <Text style={styles.text}>
            {REGISTER_IMPORT_COPY.IMPORTED_FIGURES(formatShareCount(totals.total), totals.count)}
          </Text>
          <Text style={styles.muted}>{REGISTER_IMPORT_COPY.MIRROR_NOTE}</Text>
          {proposal.members.map((member) => (
            <View key={member.member} style={styles.group}>
              <Text style={styles.heading}>{member.name}</Text>
              <Rows>
                <Row label="Address">{member.residentialAddress}</Row>
                <Row label="Shares held">{formatShareCount(member.shares)}</Row>
                <Row label="Original entry date">{member.enteredOn}</Row>
              </Rows>
              {member.allotments?.map((allotment, index) => (
                <View key={index} style={styles.group}>
                  <Text style={styles.text}>Allotment {index + 1}</Text>
                  <Rows>
                    <Row label="Original allotment date">{allotment.allottedOn}</Row>
                    <Row label="Shares still held">{formatShareCount(allotment.shares)}</Row>
                    <Row label="Share reference">{allotment.shareReference ?? 'Not recorded'}</Row>
                    <Row label="Certificate reference">{allotment.certificateReference ?? 'Not recorded'}</Row>
                    <Row label="Total paid">{allotment.amountPaid}</Row>
                    <Row label="Total unpaid">{allotment.amountUnpaid}</Row>
                    <Row label="Payment status">{allotment.fullyPaid ? 'Fully paid' : 'Partly paid'}</Row>
                    <Row label="Held for">
                      {allotment.beneficiallyHeld === null
                        ? 'Not recorded'
                        : allotment.beneficiallyHeld
                          ? 'Holder’s own benefit'
                          : 'Someone else (trustee or nominee)'}
                    </Row>
                  </Rows>
                </View>
              ))}
              {!member.allotments && <Text style={styles.muted}>{REGISTER_IMPORT_COPY.UNKNOWN_ALLOTMENTS}</Text>}
            </View>
          ))}
          {!!(proposal.registerEvidence || proposal.sourceDocument) && (
            <RegisterCopy
              label={REGISTER_IMPORT_COPY.DOWNLOAD_REGISTER}
              accessibilityLabel={`${REGISTER_IMPORT_COPY.DOWNLOAD_REGISTER} of the ${description}`}
              filename={`register-${proposal.uuid}`}
              epoch={epoch}
              guard={guard}
              read={() =>
                apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_FILE(proposal.uuid), {
                  responseType: 'arraybuffer',
                  ledovaSessionEpoch: epoch,
                  ledovaSubmissionGuard: guard,
                })
              }
            />
          )}
          {!!proposal.asicSnapshot && (
            <RegisterCopy
              label={REGISTER_IMPORT_COPY.DOWNLOAD_ASIC}
              accessibilityLabel={`${REGISTER_IMPORT_COPY.DOWNLOAD_ASIC} of the ${description}`}
              filename={`asic-extract-${proposal.uuid}`}
              epoch={epoch}
              guard={guard}
              read={() =>
                apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_ASIC_FILE(proposal.uuid), {
                  responseType: 'arraybuffer',
                  ledovaSessionEpoch: epoch,
                  ledovaSubmissionGuard: guard,
                })
              }
            />
          )}
        </>
      )}
      <View style={styles.choices}>
        {kinds.map((kind) => {
          const appointment = steps?.[kind];
          return (
            <RegisterDecision
              key={kind}
              family={REGISTER_IMPORT_DECISIONS}
              copy={REGISTER_IMPORT_COPY}
              noun="import"
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
              onRefused={onRefused}
            >
              {(preview) => <ImportPreview kind={kind} preview={preview} />}
            </RegisterDecision>
          );
        })}
      </View>
    </View>
  );
}

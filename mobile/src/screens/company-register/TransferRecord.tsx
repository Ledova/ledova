import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  formatDateTime,
  REGISTER_TRANSFER_COPY as COPY,
  REGISTER_TRANSFER_DECISIONS,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterTransfer,
  type RegisterTransferDecisionPreview,
  type RegisterStep,
} from '@ledova/shared';
import { Row, Rows } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { RegisterCopy } from './RegisterCopy';
import { RegisterDecision } from './RegisterDecision';
import { useCompanyStyles } from './styles';

function TransferRows({ transfer }: { transfer: RegisterTransfer | RegisterTransferDecisionPreview }) {
  return (
    <Rows>
      <Row label={COPY.FROM}>
        {transfer.fromName} · {transfer.fromMember}
      </Row>
      <Row label="Transferor residential address">{transfer.fromResidentialAddress}</Row>
      <Row label={COPY.TO}>
        {transfer.name} · {transfer.toMember}
      </Row>
      <Row label={COPY.ADDRESS}>{transfer.residentialAddress}</Row>
      <Row label="Recipient particulars">
        {transfer.newParticulars ? 'Retained from the signed instrument' : 'Existing retained particulars'}
      </Row>
      <Row label={COPY.SHARES}>{transfer.shares}</Row>
      <Row label={COPY.SIGNED_ON}>{transfer.signedOn}</Row>
      <Row label={COPY.LODGED_ON}>{transfer.lodgedOn}</Row>
      <Row label="Register entry date">{transfer.effectiveOn || 'Recorded on application'}</Row>
      <Row label={COPY.TERMS}>{transfer.terms}</Row>
      <Row label={COPY.DIRECTOR}>{transfer.approvingDirector}</Row>
    </Rows>
  );
}

export function TransferRecord({
  transfer,
  epoch,
  steps,
  last,
  onSettled,
}: {
  transfer: RegisterTransfer;
  epoch: number;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  last: boolean;
  onSettled: () => Promise<unknown>;
}) {
  const styles = useCompanyStyles();
  const description = `non-paid transfer from ${transfer.fromName} to ${transfer.name}, prepared ${formatDateTime(transfer.createdAt)}`;
  return (
    <View style={[styles.entry, last && styles.lastEntry]}>
      <Text style={styles.heading}>
        {COPY.STAGES[transfer.stage] ?? transfer.stage} · {transfer.fromName} → {transfer.name}
      </Text>
      <Text style={styles.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
      <TransferRows transfer={transfer} />
      <Rows>
        <Row label={COPY.AUTHORITY_REFERENCE}>{transfer.authorityReference}</Row>
        <Row label={COPY.REASON}>{transfer.reason}</Row>
        <Row label="Prepared by">{transfer.preparedByName || 'Name not recorded'}</Row>
        <Row label="Prepared on">{formatDateTime(transfer.createdAt)}</Row>
        {transfer.decisions.map((decision) => (
          <Row key={decision.uuid} label={COPY.DECISIONS[decision.kind]}>
            {[decision.decidedByName, formatDateTime(decision.decidedAt)].filter(Boolean).join(' · ')}
          </Row>
        ))}
        {!!transfer.rejectionReason && <Row label="Rejection reason">{transfer.rejectionReason}</Row>}
        {!!transfer.registerEntry && <Row label="Register entry">{transfer.registerEntry}</Row>}
      </Rows>
      {(['authority', 'instrument'] as const).map((kind) => (
        <RegisterCopy
          key={kind}
          label={`Download ${kind} document`}
          accessibilityLabel={`Download ${kind} document of ${description}`}
          filename={`${kind}-${transfer.uuid}`}
          epoch={epoch}
          read={() => {
            const config = { responseType: 'arraybuffer' as const, ledovaSessionEpoch: epoch };
            if (kind === 'authority')
              return apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_TRANSFER_FILE(transfer.uuid), config);
            return apiClient.get<ArrayBuffer>(
              COMPANY_TOKEN_ENDPOINTS.REGISTER_TRANSFER_INSTRUMENT_FILE(transfer.uuid),
              config,
            );
          }}
        />
      ))}
      {transfer.status === 'submitted' && steps && (
        <View style={styles.choices}>
          {(['approve', 'apply', 'reject'] as RegisterDecisionKind[]).map(
            (kind) =>
              steps[kind] && (
                <RegisterDecision
                  key={kind}
                  family={REGISTER_TRANSFER_DECISIONS}
                  copy={COPY}
                  noun="non-paid transfer"
                  proposal={transfer}
                  kind={kind}
                  appointment={steps[kind]!.uuid}
                  epoch={epoch}
                  description={description}
                  onSettled={onSettled}
                  onRefused={onSettled}
                >
                  {(preview) => (
                    <>
                      <TransferRows transfer={preview} />
                      <Text style={styles.muted}>{COPY.EFFECTIVE_NOTE}</Text>
                      <Rows>
                        <Row label="Register sequence">{preview.registerSequence}</Row>
                        <Row label="Transferor holding">
                          {preview.fromCurrentShares} → {preview.fromAfterShares}
                        </Row>
                        <Row label="Recipient holding">
                          {preview.toCurrentShares} → {preview.toAfterShares}
                        </Row>
                        <Row label="Issued supply">
                          {preview.issuedSupply} → {preview.afterIssuedSupply}
                        </Row>
                        <Row label="Authorised supply">{preview.authorisedSupply}</Row>
                      </Rows>
                    </>
                  )}
                </RegisterDecision>
              ),
          )}
        </View>
      )}
    </View>
  );
}

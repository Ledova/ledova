import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  formatDateTime,
  formatShareCount,
  REGISTER_ALLOTMENT_COPY as COPY,
  REGISTER_ALLOTMENT_DECISIONS,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterAllotment,
  type RegisterAllotmentDecisionPreview,
  type RegisterStep,
} from '@ledova/shared';
import { Disclosure, Row, Rows } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { RegisterCopy } from '../../components/register/RegisterCopy';
import { RegisterDecision } from '../../components/register/RegisterDecision';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';

const ISSUE_COPY = {
  ...COPY,
  DECISIONS: { ...COPY.DECISIONS, apply: 'Record issue' },
  CONFIRMATIONS: { ...COPY.CONFIRMATIONS, apply: 'Record the approved shares in the register.' },
};

function AllotmentRows({ allotment }: { allotment: RegisterAllotment | RegisterAllotmentDecisionPreview }) {
  return (
    <Rows>
      <Row label="Investor/member">
        {allotment.name} · {allotment.member}
      </Row>
      <Row label="Residential address">{allotment.residentialAddress}</Row>
      <Row label="Member record">{allotment.newMember ? 'New member' : 'Existing member'}</Row>
      <Row label={COPY.SHARES}>{allotment.shares}</Row>
      <Row label={COPY.CONSIDERATION}>AUD {allotment.consideration}</Row>
      <Row label="External agreement record">{allotment.agreement.uuid}</Row>
      <Row label={COPY.AGREEMENT_REFERENCE}>{allotment.agreement.reference}</Row>
      <Row label={COPY.AGREEMENT_ON}>{allotment.agreement.agreedOn}</Row>
      <Row label={COPY.TERMS}>{allotment.agreement.terms}</Row>
      <Row label="Agreement recorded">
        {allotment.agreement.recordedBy} · {formatDateTime(allotment.agreement.recordedAt)}
      </Row>
      <Row label="Company contribution record">{allotment.contribution.uuid}</Row>
      <Row label={COPY.RECEIVED_AMOUNT}>AUD {allotment.contribution.amount}</Row>
      <Row label={COPY.RECEIVED_ON}>{allotment.contribution.receivedOn}</Row>
      <Row label="Receipt attested">
        {allotment.contribution.recordedBy} · {formatDateTime(allotment.contribution.recordedAt)}
      </Row>
      <Row label={COPY.COMPANY_EVENT_ON}>{allotment.companyEventOn ?? 'Not recorded'}</Row>
      {allotment.effectiveOn && allotment.effectiveOn !== allotment.companyEventOn && (
        <Row label="Retained ledger effective date">{allotment.effectiveOn}</Row>
      )}
      <Row label={COPY.DIRECTOR}>{allotment.approvingDirector}</Row>
    </Rows>
  );
}

export function AllotmentRecord({
  allotment,
  epoch,
  steps,
  onSettled,
  guard,
  newEffectGuard,
  visible = true,
  onHeldChange,
}: {
  allotment: RegisterAllotment;
  epoch: number;
  steps?: Partial<Record<RegisterStep, OwnCompanyAppointment>>;
  onSettled: () => Promise<unknown>;
  guard: () => void;
  newEffectGuard: (kind: RegisterDecisionKind) => void;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
}) {
  const styles = useCompanyStyles();
  const [details, setDetails] = useState(false);
  const description = `external allotment for ${allotment.name}, prepared ${formatDateTime(allotment.createdAt)}`;
  const documents: ('authority' | 'agreement' | 'receipt')[] = ['authority', 'agreement', 'receipt'];
  return (
    <View style={visible ? styles.entry : undefined}>
      {visible && (
        <>
          <Text style={styles.heading}>
            {COPY.STAGES[allotment.stage] ?? allotment.stage} · {allotment.name}
          </Text>
          <Text style={styles.text}>
            {formatShareCount(allotment.shares)} shares · AUD {allotment.consideration}
          </Text>
          <Text style={styles.muted}>
            {allotment.registerEntry
              ? 'Shares recorded in the register.'
              : allotment.stage === 'approved'
                ? 'Approved. Record the issue to create the holding.'
                : allotment.stage === 'rejected'
                  ? 'Refused. The retained agreement and receipt remain available.'
                  : 'Prepared. Company approval is required before the issue.'}
          </Text>
          <Disclosure
            open={details}
            onToggle={() => setDetails((value) => !value)}
            accessibilityLabel={`Allotment records for ${allotment.name}`}
            summary={<Text style={styles.muted}>Records and documents</Text>}
          >
            <Text style={styles.muted}>{COPY.RECEIPT_NOTE}</Text>
            <AllotmentRows allotment={allotment} />
            <Rows>
              <Row label={COPY.AUTHORITY_REFERENCE}>{allotment.authorityReference}</Row>
              <Row label={COPY.REASON}>{allotment.reason}</Row>
              <Row label="Prepared by">{allotment.preparedByName || 'Name not recorded'}</Row>
              <Row label="Prepared on">{formatDateTime(allotment.createdAt)}</Row>
              {allotment.decisions.map((decision) => (
                <Row key={decision.uuid} label={COPY.DECISIONS[decision.kind]}>
                  {[decision.decidedByName, formatDateTime(decision.decidedAt)].filter(Boolean).join(' · ')}
                </Row>
              ))}
              {!!allotment.rejectionReason && <Row label="Rejection reason">{allotment.rejectionReason}</Row>}
              {!!allotment.registerEntry && <Row label="Register entry">{allotment.registerEntry}</Row>}
            </Rows>
            {documents.map((kind) => (
              <RegisterCopy
                key={kind}
                label={`Download ${kind} document`}
                accessibilityLabel={`Download ${kind} document of ${description}`}
                filename={`${kind}-${allotment.uuid}`}
                epoch={epoch}
                guard={guard}
                read={() => {
                  const config = {
                    responseType: 'arraybuffer' as const,
                    ledovaSessionEpoch: epoch,
                    ledovaSubmissionGuard: guard,
                  };
                  if (kind === 'authority')
                    return apiClient.get<ArrayBuffer>(
                      COMPANY_TOKEN_ENDPOINTS.REGISTER_ALLOTMENT_FILE(allotment.uuid),
                      config,
                    );
                  if (kind === 'agreement')
                    return apiClient.get<ArrayBuffer>(
                      COMPANY_TOKEN_ENDPOINTS.REGISTER_ALLOTMENT_AGREEMENT_FILE(allotment.uuid),
                      config,
                    );
                  return apiClient.get<ArrayBuffer>(
                    COMPANY_TOKEN_ENDPOINTS.REGISTER_ALLOTMENT_RECEIPT_FILE(allotment.uuid),
                    config,
                  );
                }}
              />
            ))}
          </Disclosure>
        </>
      )}
      <View style={styles.choices}>
        {(['approve', 'apply', 'reject'] as RegisterDecisionKind[]).map((kind) => (
          <RegisterDecision
            key={kind}
            family={REGISTER_ALLOTMENT_DECISIONS}
            copy={ISSUE_COPY}
            noun="external allotment"
            proposal={allotment}
            kind={kind}
            appointment={steps?.[kind]?.uuid}
            visible={visible}
            enabled={
              allotment.status === 'submitted' &&
              (kind === 'reject' ||
                (!!allotment.companyEventOn && (kind !== 'apply' || allotment.stage === 'approved')))
            }
            onHeldChange={onHeldChange}
            epoch={epoch}
            readGuard={guard}
            newEffectGuard={() => newEffectGuard(kind)}
            description={description}
            onSettled={onSettled}
            onRefused={onSettled}
          >
            {(preview) => (
              <>
                <AllotmentRows allotment={preview} />
                <Text style={styles.muted}>{COPY.EFFECTIVE_NOTE}</Text>
                <Rows>
                  <Row label="Register sequence">{preview.registerSequence}</Row>
                  <Row label="Member holding">
                    {preview.currentShares} → {preview.afterShares}
                  </Row>
                  <Row label="Issued supply">
                    {preview.issuedSupply} → {preview.afterIssuedSupply}
                  </Row>
                  <Row label="Authorised supply">{preview.authorisedSupply}</Row>
                </Rows>
              </>
            )}
          </RegisterDecision>
        ))}
      </View>
    </View>
  );
}

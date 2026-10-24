import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  formatDate,
  formatDateTime,
  formatMoney,
  REGISTER_ALLOTMENT_COPY as COPY,
  REGISTER_ALLOTMENT_DECISIONS,
  shareCount,
  shortReference,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterAllotment,
  type RegisterAllotmentDecisionPreview,
  type RegisterStep,
} from '@ledova/shared';
import { Disclosure, Row, Rows, Status } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { RegisterCopy } from '../../components/register/RegisterCopy';
import { RegisterDecision } from '../../components/register/RegisterDecision';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { AllotmentOwnership } from './AllotmentOwnership';
import { ISSUE_TONES, IssueSummary, decisionRows } from './IssueSummary';

const ISSUE_COPY = {
  ...COPY,
  DECISIONS: { ...COPY.DECISIONS, apply: 'Record issue' },
  CONFIRMATIONS: { ...COPY.CONFIRMATIONS, apply: 'Record the approved shares in the register.' },
};

const TRAIL_LABELS = { ...COPY.DECISIONS, approve: 'Approve', apply: 'Shares recorded' };

function AllotmentRows({ allotment }: { allotment: RegisterAllotment | RegisterAllotmentDecisionPreview }) {
  return (
    <Rows>
      <Row label="Investor/member">{allotment.name}</Row>
      <Row label="Residential address">{allotment.residentialAddress}</Row>
      <Row label="Member record">{allotment.newMember ? 'New member' : 'Existing member'}</Row>
      <Row label={COPY.SHARES}>{shareCount(allotment.shares)}</Row>
      <Row label={COPY.CONSIDERATION}>{formatMoney(allotment.consideration, allotment.currency)}</Row>
      <Row label={COPY.AGREEMENT_REFERENCE}>{allotment.agreement.reference}</Row>
      <Row label={COPY.AGREEMENT_ON}>{formatDate(allotment.agreement.agreedOn)}</Row>
      <Row label={COPY.TERMS}>{allotment.agreement.terms}</Row>
      <Row label="Agreement recorded">{formatDateTime(allotment.agreement.recordedAt)}</Row>
      <Row label={COPY.RECEIVED_AMOUNT}>{formatMoney(allotment.contribution.amount, allotment.currency)}</Row>
      <Row label={COPY.RECEIVED_ON}>{formatDate(allotment.contribution.receivedOn)}</Row>
      <Row label="Receipt attested">{formatDateTime(allotment.contribution.recordedAt)}</Row>
      <Row label={COPY.COMPANY_EVENT_ON}>{formatDate(allotment.companyEventOn, 'Not recorded')}</Row>
      {!!allotment.effectiveOn && allotment.effectiveOn !== allotment.companyEventOn && (
        <Row label="Ledger date">{formatDate(allotment.effectiveOn)}</Row>
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
          <IssueSummary
            name={allotment.name}
            kind="Investor issue"
            shares={allotment.shares}
            amount={formatMoney(allotment.consideration, allotment.currency)}
            companyEventOn={allotment.companyEventOn}
            status={
              <>
                <Status tone={ISSUE_TONES[allotment.stage] ?? 'waiting'}>
                  {allotment.stage === 'applied'
                    ? 'Approved'
                    : allotment.stage === 'approved'
                      ? 'Ready to complete'
                      : (COPY.STAGES[allotment.stage] ?? allotment.stage)}
                </Status>
                <Text style={styles.muted}>{allotment.stage === 'applied' ? 'Shares issued' : 'No shares issued'}</Text>
              </>
            }
          />
          <Disclosure
            open={details}
            onToggle={() => setDetails((value) => !value)}
            accessibilityLabel={`Details and documents for ${allotment.name}`}
            summary={<Text style={styles.muted}>Details and documents</Text>}
          >
            <Text style={styles.muted}>
              {allotment.stage === 'applied'
                ? `${allotment.companyEventOn ? `Shares issued on ${formatDate(allotment.companyEventOn)}` : 'Shares issued; company issue date not recorded'}. The company remains responsible for any required ASIC notification and certificate execution and delivery. Generated certificates remain unsigned.`
                : allotment.stage === 'approved'
                  ? 'Approval is on file; the share issue has not been recorded.'
                  : allotment.stage === 'rejected'
                    ? 'No shares were issued by this rejected allotment. The agreement and company receipt remain recorded.'
                    : 'Ready for approval. No shares issued.'}
            </Text>
            <Rows>
              <Row label="Stage">{COPY.STAGES[allotment.stage] ?? allotment.stage}</Row>
              <Row label="Prepared by">{allotment.preparedByName || 'Name not recorded'}</Row>
              <Row label="Prepared on">{formatDateTime(allotment.createdAt)}</Row>
              <Row label={COPY.AUTHORITY_REFERENCE}>{allotment.authorityReference}</Row>
              <Row label={COPY.REASON}>{allotment.reason}</Row>
              {decisionRows(allotment, TRAIL_LABELS)}
              {!!allotment.registerEntry && <Row label="Register entry">{shortReference(allotment.registerEntry)}</Row>}
              <Row label="Allotment record">{shortReference(allotment.uuid)}</Row>
              <Row label="Member reference">{shortReference(allotment.member)}</Row>
              <Row label="External agreement record">{shortReference(allotment.agreement.uuid)}</Row>
              <Row label="Company contribution record">{shortReference(allotment.contribution.uuid)}</Row>
              <Row label="Authority evidence SHA-256" mono>
                {allotment.evidenceFingerprint}
              </Row>
              <Row label="Agreement evidence SHA-256" mono>
                {allotment.agreement.evidenceFingerprint}
              </Row>
              <Row label="Receipt evidence SHA-256" mono>
                {allotment.contribution.evidenceFingerprint}
              </Row>
            </Rows>
            <AllotmentRows allotment={allotment} />
            <Text style={styles.muted}>{COPY.RECEIPT_NOTE}</Text>
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
                {kind !== 'reject' && allotment.status === 'submitted' && !allotment.registerEntry && (
                  <AllotmentOwnership preview={preview} />
                )}
                <AllotmentRows allotment={preview} />
                <Text style={styles.muted}>{COPY.EFFECTIVE_NOTE}</Text>
                <Rows>
                  <Row label="Register sequence">{preview.registerSequence}</Row>
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

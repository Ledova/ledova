import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  formatDateTime,
  formatShareCount,
  REGISTER_GRANT_COPY as COPY,
  REGISTER_AWARD_COPY as AWARD_COPY,
  REGISTER_GRANT_DECISIONS,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterGrant,
  type RegisterGrantDecisionPreview,
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

function GrantRows({ grant }: { grant: RegisterGrant | RegisterGrantDecisionPreview }) {
  return (
    <Rows>
      {grant.award && <Row label="Employee award">{grant.award}</Row>}
      {'awardPromisedShares' in grant && grant.award && (
        <>
          <Row label={AWARD_COPY.PROMISED}>{grant.awardPromisedShares}</Row>
          <Row label={AWARD_COPY.VESTED}>{grant.awardVestedShares}</Row>
          <Row label={AWARD_COPY.ISSUED}>{grant.awardIssuedShares}</Row>
          <Row label={AWARD_COPY.AVAILABLE}>{grant.awardAvailableShares}</Row>
        </>
      )}
      <Row label="Member">
        {grant.name} · {grant.member}
      </Row>
      <Row label={COPY.RESIDENTIAL_ADDRESS}>{grant.residentialAddress}</Row>
      <Row label="Member record">{grant.newMember ? 'New member' : 'Existing member'}</Row>
      <Row label={COPY.SHARES}>{grant.shares}</Row>
      <Row label={COPY.TERMS_ON}>{grant.termsOn}</Row>
      <Row label={COPY.COMPANY_EVENT_ON}>{grant.companyEventOn ?? 'Not recorded'}</Row>
      {grant.effectiveOn && grant.effectiveOn !== grant.companyEventOn && (
        <Row label="Retained ledger effective date">{grant.effectiveOn}</Row>
      )}
      <Row label={COPY.DIRECTOR}>{grant.approvingDirector}</Row>
      <Row label={COPY.TERMS}>{grant.terms}</Row>
      <Row label="Recipient acceptance">
        {grant.acceptanceRequired ? 'Required, evidence retained' : 'Not required by these terms'}
      </Row>
    </Rows>
  );
}

export function GrantRecord({
  grant,
  epoch,
  steps,
  last,
  onSettled,
  visible = true,
  guard,
  onHeldChange,
}: {
  grant: RegisterGrant;
  epoch: number;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  last: boolean;
  onSettled: () => Promise<unknown>;
  visible?: boolean;
  guard?: () => void;
  onHeldChange?: (uuid: string, held: boolean) => void;
}) {
  const styles = useCompanyStyles();
  const [details, setDetails] = useState(false);
  const description = `non-paid grant for ${grant.name}, prepared ${formatDateTime(grant.createdAt)}`;
  const documents: ('authority' | 'terms' | 'acceptance')[] = grant.acceptanceEvidence
    ? ['authority', 'terms', 'acceptance']
    : ['authority', 'terms'];
  return (
    <View style={visible ? [styles.entry, last && styles.lastEntry] : undefined}>
      {visible && (
        <>
          <Text style={styles.heading}>
            {COPY.STAGES[grant.stage] ?? grant.stage} · {grant.name}
          </Text>
          <Text style={styles.text}>{formatShareCount(grant.shares)} shares</Text>
          <Text style={styles.muted}>
            {grant.registerEntry
              ? 'Shares recorded in the register.'
              : grant.stage === 'approved'
                ? 'Approved. Record the issue to create the holding.'
                : grant.stage === 'rejected'
                  ? 'Refused. No shares were issued.'
                  : 'Prepared. Company approval is required before the issue.'}
          </Text>
          <Disclosure
            open={details}
            onToggle={() => setDetails((value) => !value)}
            accessibilityLabel={`Issue records for ${grant.name}`}
            summary={<Text style={styles.muted}>Records and documents</Text>}
          >
            <Text style={styles.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
            <GrantRows grant={grant} />
            <Rows>
              <Row label={COPY.AUTHORITY_REFERENCE}>{grant.authorityReference}</Row>
              <Row label={COPY.REASON}>{grant.reason}</Row>
              <Row label="Prepared by">{grant.preparedByName || 'Name not recorded'}</Row>
              <Row label="Prepared on">{formatDateTime(grant.createdAt)}</Row>
              {grant.decisions.map((decision) => (
                <Row key={decision.uuid} label={COPY.DECISIONS[decision.kind]}>
                  {[decision.decidedByName, formatDateTime(decision.decidedAt)].filter(Boolean).join(' · ')}
                </Row>
              ))}
              {!!grant.rejectionReason && <Row label="Rejection reason">{grant.rejectionReason}</Row>}
              {!!grant.registerEntry && <Row label="Register entry">{grant.registerEntry}</Row>}
            </Rows>
            {documents.map((kind) => (
              <RegisterCopy
                key={kind}
                label={`Download ${kind} document`}
                accessibilityLabel={`Download ${kind} document of ${description}`}
                filename={`${kind}-${grant.uuid}`}
                epoch={epoch}
                guard={guard}
                read={() => {
                  const config = {
                    responseType: 'arraybuffer' as const,
                    ledovaSessionEpoch: epoch,
                    ledovaSubmissionGuard: guard,
                  };
                  if (kind === 'authority')
                    return apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_FILE(grant.uuid), config);
                  if (kind === 'terms')
                    return apiClient.get<ArrayBuffer>(
                      COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_TERMS_FILE(grant.uuid),
                      config,
                    );
                  return apiClient.get<ArrayBuffer>(
                    COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_ACCEPTANCE_FILE(grant.uuid),
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
            family={REGISTER_GRANT_DECISIONS}
            copy={ISSUE_COPY}
            noun="non-paid grant"
            proposal={grant}
            kind={kind}
            appointment={steps?.[kind]?.uuid}
            visible={visible}
            enabled={
              grant.status === 'submitted' &&
              (kind === 'reject' || (!!grant.companyEventOn && (kind !== 'apply' || grant.stage === 'approved')))
            }
            readGuard={guard}
            newEffectGuard={guard}
            onHeldChange={onHeldChange}
            epoch={epoch}
            description={description}
            onSettled={onSettled}
            onRefused={onSettled}
          >
            {(preview) => (
              <>
                <GrantRows grant={preview} />
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

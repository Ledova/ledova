import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import {
  COMPANY_TOKEN_ENDPOINTS,
  formatDate,
  formatDateTime,
  REGISTER_GRANT_COPY as COPY,
  REGISTER_GRANT_DECISIONS,
  shareCount,
  shortReference,
  type OwnCompanyAppointment,
  type RegisterDecisionKind,
  type RegisterGrant,
  type RegisterStep,
} from '@ledova/shared';
import { Disclosure, Row, Rows, Status } from '../../components/Ledger';
import { apiClient } from '../../services/apiClient';
import { RegisterCopy } from '../../components/register/RegisterCopy';
import { RegisterDecisions } from '../../components/register/RegisterDecisions';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { GrantReview } from './IssueReviews';
import { ISSUE_TONES, IssueSummary, decisionRows } from './IssueSummary';

const DECISION_COPY = { ...COPY, DECISIONS: { ...COPY.DECISIONS, apply: 'Record issue' } };

function GrantRows({ grant }: { grant: RegisterGrant }) {
  return (
    <Rows>
      {!!grant.award && <Row label="Employee award">{shortReference(grant.award)}</Row>}
      <Row label="Member">{grant.name}</Row>
      <Row label={COPY.RESIDENTIAL_ADDRESS}>{grant.residentialAddress}</Row>
      <Row label="Member record">{grant.newMember ? 'New member' : 'Existing member'}</Row>
      <Row label={COPY.SHARES}>{shareCount(grant.shares)}</Row>
      <Row label={COPY.TERMS_ON}>{formatDate(grant.termsOn)}</Row>
      <Row label={COPY.COMPANY_EVENT_ON}>{formatDate(grant.companyEventOn, 'Not recorded')}</Row>
      {!!grant.registerEntry && !!grant.effectiveOn && grant.effectiveOn !== grant.companyEventOn && (
        <Row label="Ledger date">{formatDate(grant.effectiveOn)}</Row>
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
  newEffectGuard,
  classLabel,
  onHeldChange,
  onReviewChange,
}: {
  grant: RegisterGrant;
  epoch: number;
  steps: Partial<Record<RegisterStep, OwnCompanyAppointment | undefined>>;
  last: boolean;
  onSettled: () => Promise<unknown>;
  visible?: boolean;
  guard: () => void;
  newEffectGuard: (kind: RegisterDecisionKind) => void;
  classLabel: string;
  onHeldChange?: (uuid: string, held: boolean) => void;
  onReviewChange: (uuid: string, open: boolean) => void;
}) {
  const styles = useCompanyStyles();
  const [details, setDetails] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const description = `non-paid grant for ${grant.name}, prepared ${formatDateTime(grant.createdAt)}`;
  const kinds: ('authority' | 'terms' | 'acceptance')[] = grant.acceptanceEvidence
    ? ['authority', 'terms', 'acceptance']
    : ['authority', 'terms'];
  const reviewChanged = useCallback(
    (open: boolean) => {
      setReviewing(open);
      onReviewChange(grant.uuid, open);
    },
    [grant.uuid, onReviewChange],
  );
  const documents = kinds.map((kind) => (
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
          return apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_TERMS_FILE(grant.uuid), config);
        return apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_ACCEPTANCE_FILE(grant.uuid), config);
      }}
    />
  ));
  return (
    <View style={visible ? [styles.entry, last && styles.lastEntry] : undefined}>
      {visible && !reviewing && (
        <>
          <IssueSummary
            name={grant.name}
            kind={grant.award ? 'Employee award' : 'Non-paid issue'}
            shares={grant.shares}
            companyEventOn={grant.companyEventOn}
            status={
              <>
                <Status tone={ISSUE_TONES[grant.stage] ?? 'waiting'}>
                  {grant.stage === 'applied' ? 'Shares issued' : (COPY.STAGES[grant.stage] ?? grant.stage)}
                </Status>
                {grant.stage !== 'applied' && <Text style={styles.muted}>No shares issued</Text>}
              </>
            }
          />
          <Disclosure
            open={details}
            onToggle={() => setDetails((value) => !value)}
            accessibilityLabel={`Details and documents for ${grant.name}`}
            summary={<Text style={styles.muted}>Details and documents</Text>}
          >
            <Text style={styles.muted}>
              {grant.stage === 'applied'
                ? 'These shares are issued ownership. An employee award and its vesting records remain separate.'
                : grant.stage === 'approved'
                  ? 'Next: record the approved issue. Approval has not changed ownership.'
                  : grant.stage === 'rejected'
                    ? 'This rejected instruction issued no shares.'
                    : 'Ready for approval. No shares issued.'}
            </Text>
            <Rows>
              <Row label="Stage">{COPY.STAGES[grant.stage] ?? grant.stage}</Row>
              <Row label="Prepared by">{grant.preparedByName || 'Name not recorded'}</Row>
              <Row label="Prepared on">{formatDateTime(grant.createdAt)}</Row>
              <Row label={COPY.AUTHORITY_REFERENCE}>{grant.authorityReference}</Row>
              <Row label={COPY.REASON}>{grant.reason}</Row>
              {decisionRows(grant, DECISION_COPY.DECISIONS)}
              {!!grant.registerEntry && <Row label="Register entry">{shortReference(grant.registerEntry)}</Row>}
            </Rows>
            <GrantRows grant={grant} />
            <Text style={styles.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
            {documents}
            <Rows>
              <Row label="Issue record">{shortReference(grant.uuid)}</Row>
              <Row label="Member reference">{shortReference(grant.member)}</Row>
            </Rows>
          </Disclosure>
        </>
      )}
      <RegisterDecisions
        family={REGISTER_GRANT_DECISIONS}
        copy={DECISION_COPY}
        proposal={grant}
        steps={grant.stage === 'submitted' ? { ...steps, apply: undefined } : steps}
        epoch={epoch}
        readGuard={guard}
        newEffectGuard={newEffectGuard}
        description={description}
        onDecided={onSettled}
        onRefused={onSettled}
        visible={visible}
        onHeldChange={onHeldChange}
        approveLabel="Review and approve"
        review={{
          onChange: reviewChanged,
          labels: { approve: 'Approve', apply: 'Record issue', reject: 'Reject issue' },
        }}
      >
        {(preview, kind) => (
          <GrantReview
            preview={preview}
            proposal={grant}
            classLabel={classLabel}
            documents={documents}
            showOwnership={kind !== 'reject'}
            approving={kind === 'approve'}
          />
        )}
      </RegisterDecisions>
    </View>
  );
}

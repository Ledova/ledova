import { useCallback } from 'react';
import { Text, View } from 'react-native';
import {
  ISSUE_GROUPS,
  REGISTER_GRANT_COPY as COPY,
  REGISTER_GRANT_DECISIONS,
  STAGE_TONES,
  formatDate,
  formatDateTime,
  formatShortDate,
  recordGroup,
  shareCount,
  useGrantRecordDownload,
  type RegisterDecisionKind,
  type RegisterGrant,
  type RegisterSteps,
} from '@ledova/shared';
import { Fact, Rows, Status } from '../../components/Ledger';
import { SHARE_SHEET_FILES } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { DocumentActions, RecordShell, RecordSummary, decisionTrail } from './IssueRecord';
import { GrantReview } from './IssueReviews';
import { RegisterDecisions } from './RegisterDecisions';
import { useLedgerStyles } from './useLedgerStyles';

const DECISION_COPY = { ...COPY, DECISIONS: { ...COPY.DECISIONS, apply: 'Record issue' } };

export function GrantRecord({
  grant,
  steps,
  guard,
  onSettled,
  visible,
  onHeldChange,
  newEffectGuard,
  focusKey,
  onFocus,
  classLabel,
  reviewing,
  onReviewChange,
  ruled,
  collapsed,
}: {
  grant: RegisterGrant;
  steps: RegisterSteps;
  guard: () => void;
  onSettled: () => Promise<unknown>;
  visible: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
  newEffectGuard?: (kind: RegisterDecisionKind) => void;
  focusKey?: string;
  onFocus?: (record: View) => void;
  classLabel: string;
  reviewing: string | null;
  onReviewChange: (uuid: string, open: boolean) => void;
  ruled: boolean;
  collapsed: boolean;
}) {
  const look = useLedgerStyles();
  const download = useGrantRecordDownload(grant, guard, SHARE_SHEET_FILES, orderSubmissionSession);
  const context = `grant for ${grant.name} prepared ${formatDateTime(grant.createdAt)}`;
  const documents = grant.acceptanceEvidence
    ? (['authority', 'terms', 'acceptance'] as const)
    : (['authority', 'terms'] as const);
  const reviewChanged = useCallback((open: boolean) => onReviewChange(grant.uuid, open), [grant.uuid, onReviewChange]);
  const inReview = reviewing === grant.uuid;
  const stage = COPY.STAGES[grant.stage] ?? grant.stage;
  const documentsView = <DocumentActions kinds={documents} context={context} download={download} />;
  return (
    <RecordShell
      hidden={!visible || (reviewing ? !inReview : collapsed)}
      ruled={ruled && !reviewing}
      focusKey={focusKey}
      onFocus={onFocus}
    >
      {visible && (
        <View style={[look.summary, inReview && look.hidden]}>
          <RecordSummary
            name={grant.name}
            figure={shareCount(grant.shares)}
            facts={`${grant.award ? 'Employee award' : 'Non-paid issue'} · ${formatShortDate(grant.companyEventOn, 'Date not recorded')}`}
            status={
              recordGroup(ISSUE_GROUPS, grant.stage) === 'decide'
                ? { tone: STAGE_TONES[grant.stage] ?? 'waiting', label: stage }
                : undefined
            }
          >
            <Text style={look.muted}>
              {grant.stage === 'applied'
                ? 'These shares are issued ownership. An employee award and its vesting records remain separate.'
                : grant.stage === 'approved'
                  ? 'Next: record the approved issue. Approval has not changed ownership.'
                  : grant.stage === 'rejected'
                    ? 'This rejected instruction issued no shares.'
                    : 'Ready for approval. No shares issued.'}
            </Text>
            <Rows>
              <Fact label="Stage">
                <Status tone={STAGE_TONES[grant.stage] ?? 'waiting'}>{stage}</Status>
              </Fact>
              <Fact label="Prepared by">{grant.preparedByName || 'Name not recorded'}</Fact>
              <Fact label="Prepared on">{formatDateTime(grant.createdAt)}</Fact>
              <Fact label={COPY.AUTHORITY_REFERENCE}>{grant.authorityReference}</Fact>
              <Fact label={COPY.REASON}>{grant.reason}</Fact>
              {decisionTrail(grant, DECISION_COPY.DECISIONS)}
            </Rows>
            <Rows>
              {!!grant.award && <Fact label="Source">Employee award</Fact>}
              <Fact label="Member">{grant.name}</Fact>
              <Fact label={COPY.RESIDENTIAL_ADDRESS}>{grant.residentialAddress}</Fact>
              <Fact label="Member record">{grant.newMember ? 'New member' : 'Existing member'}</Fact>
              <Fact label={COPY.SHARES}>{shareCount(grant.shares)}</Fact>
              <Fact label={COPY.TERMS_ON}>{formatDate(grant.termsOn)}</Fact>
              <Fact label={COPY.COMPANY_EVENT_ON}>{formatDate(grant.companyEventOn, 'Not recorded')}</Fact>
              {!!grant.registerEntry && !!grant.effectiveOn && grant.effectiveOn !== grant.companyEventOn && (
                <Fact label="Ledger date">{formatDate(grant.effectiveOn)}</Fact>
              )}
              <Fact label={COPY.DIRECTOR}>{grant.approvingDirector}</Fact>
              <Fact label={COPY.TERMS}>{grant.terms}</Fact>
              <Fact label="Recipient acceptance">
                {grant.acceptanceRequired ? 'Required, evidence retained' : 'Not required by these terms'}
              </Fact>
            </Rows>
            <Text style={look.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
            {documentsView}
          </RecordSummary>
        </View>
      )}
      <RegisterDecisions
        approveLabel="Review and approve"
        family={REGISTER_GRANT_DECISIONS}
        copy={DECISION_COPY}
        proposal={grant}
        steps={grant.stage === 'submitted' ? { ...steps, apply: undefined } : steps}
        guard={guard}
        newEffectGuard={newEffectGuard}
        context={context}
        onDecided={onSettled}
        onRefused={onSettled}
        visible={visible}
        onHeldChange={onHeldChange}
        review={{
          onChange: reviewChanged,
          title: 'Review share issue',
          labels: { approve: 'Approve', apply: 'Record issue', reject: 'Reject issue' },
        }}
      >
        {(preview, kind) => (
          <GrantReview
            preview={preview}
            proposal={grant}
            classLabel={classLabel}
            documents={documentsView}
            showOwnership={kind !== 'reject'}
            approving={kind === 'approve'}
          />
        )}
      </RegisterDecisions>
    </RecordShell>
  );
}

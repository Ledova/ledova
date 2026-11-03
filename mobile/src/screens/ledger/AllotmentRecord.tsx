import { useCallback } from 'react';
import { Text, View } from 'react-native';
import {
  REGISTER_ALLOTMENT_COPY as COPY,
  REGISTER_ALLOTMENT_DECISIONS,
  STAGE_TONES,
  formatDate,
  formatDateTime,
  formatMoney,
  shareCount,
  useAllotmentRecordDownload,
  type RegisterAllotment,
  type RegisterAllotmentDecisionRequest,
  type RegisterDecisionKind,
  type RegisterSteps,
} from '@ledova/shared';
import { Fact, Rows, ShowMore, Status } from '../../components/Ledger';
import { SHARE_SHEET_FILES } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { DocumentActions, IssueSummary, RecordShell, decisionTrail } from './IssueRecord';
import { AllotmentReview } from './IssueReviews';
import { RegisterDecisions } from './RegisterDecisions';
import { useLedgerStyles } from './useLedgerStyles';

const DECISION_COPY = { ...COPY, DECISIONS: { ...COPY.DECISIONS, approve: 'Approve', apply: 'Shares recorded' } };
const DOCUMENTS = ['authority', 'agreement', 'receipt'] as const;

export function AllotmentRecord({
  allotment,
  steps,
  guard,
  onSettled,
  newEffectGuard,
  visible,
  onHeldChange,
  focusKey,
  onFocus,
  reviewing,
  onReviewChange,
  ruled,
}: {
  allotment: RegisterAllotment;
  steps: RegisterSteps;
  guard: () => void;
  onSettled: () => Promise<unknown>;
  newEffectGuard: (kind: RegisterDecisionKind) => void;
  visible: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
  focusKey?: string;
  onFocus?: (record: View) => void;
  reviewing: string | null;
  onReviewChange: (uuid: string, open: boolean) => void;
  ruled: boolean;
}) {
  const look = useLedgerStyles();
  const download = useAllotmentRecordDownload(allotment, guard, SHARE_SHEET_FILES, orderSubmissionSession);
  const context = `allotment for ${allotment.name} prepared ${formatDateTime(allotment.createdAt)}`;
  const decisionSteps = { ...steps, apply: undefined };
  const family = {
    ...REGISTER_ALLOTMENT_DECISIONS,
    request: (request: RegisterAllotmentDecisionRequest): RegisterAllotmentDecisionRequest =>
      request.kind === 'approve'
        ? { ...request, completeIssue: true, applyAppointment: steps.apply?.uuid ?? request.appointment }
        : request,
  };
  const reviewChanged = useCallback(
    (open: boolean) => onReviewChange(allotment.uuid, open),
    [allotment.uuid, onReviewChange],
  );
  const inReview = reviewing === allotment.uuid;
  const stage = COPY.STAGES[allotment.stage] ?? allotment.stage;
  const documentsView = <DocumentActions kinds={DOCUMENTS} context={context} download={download} />;
  return (
    <RecordShell
      hidden={!visible || (!!reviewing && !inReview)}
      ruled={ruled && !reviewing}
      focusKey={focusKey}
      onFocus={onFocus}
    >
      {visible && (
        <View style={[look.summary, inReview && look.hidden]}>
          <IssueSummary
            name={allotment.name}
            kind="Investor issue"
            shares={allotment.shares}
            amount={formatMoney(allotment.consideration, allotment.currency)}
            companyEventOn={allotment.companyEventOn}
            status={{
              tone: STAGE_TONES[allotment.stage] ?? 'waiting',
              label:
                allotment.stage === 'applied'
                  ? 'Approved'
                  : allotment.stage === 'approved'
                    ? 'Ready to complete'
                    : stage,
              note: allotment.stage === 'applied' ? 'Shares issued' : 'No shares issued',
            }}
          />
          <ShowMore show="Show details and documents" hide="Hide details and documents">
            <Text style={look.muted}>
              {allotment.stage === 'applied'
                ? `${allotment.companyEventOn ? `Shares issued on ${formatDate(allotment.companyEventOn)}` : 'Shares issued; company issue date not recorded'}. The company remains responsible for any required ASIC notification and certificate execution and delivery. Generated certificates remain unsigned.`
                : allotment.stage === 'approved'
                  ? 'Approval is on file; the share issue has not been recorded.'
                  : allotment.stage === 'rejected'
                    ? 'No shares were issued by this rejected allotment. The agreement and company receipt remain recorded.'
                    : 'Ready for approval. No shares issued.'}
            </Text>
            <Rows>
              <Fact label="Stage">
                <Status tone={STAGE_TONES[allotment.stage] ?? 'waiting'}>{stage}</Status>
              </Fact>
              <Fact label="Prepared by">{allotment.preparedByName || 'Name not recorded'}</Fact>
              <Fact label="Prepared on">{formatDateTime(allotment.createdAt)}</Fact>
              <Fact label={COPY.AUTHORITY_REFERENCE}>{allotment.authorityReference}</Fact>
              <Fact label={COPY.REASON}>{allotment.reason}</Fact>
              {decisionTrail(allotment, DECISION_COPY.DECISIONS)}
            </Rows>
            <Rows>
              <Fact label="Investor/member">{allotment.name}</Fact>
              <Fact label="Residential address">{allotment.residentialAddress}</Fact>
              <Fact label="Member record">{allotment.newMember ? 'New member' : 'Existing member'}</Fact>
              <Fact label={COPY.SHARES}>{shareCount(allotment.shares)}</Fact>
              <Fact label={COPY.CONSIDERATION}>{formatMoney(allotment.consideration, allotment.currency)}</Fact>
              <Fact label={COPY.AGREEMENT_REFERENCE}>{allotment.agreement.reference}</Fact>
              <Fact label={COPY.AGREEMENT_ON}>{formatDate(allotment.agreement.agreedOn)}</Fact>
              <Fact label={COPY.TERMS}>{allotment.agreement.terms}</Fact>
              <Fact label="Agreement recorded">{formatDateTime(allotment.agreement.recordedAt)}</Fact>
              <Fact label={COPY.RECEIVED_AMOUNT}>{formatMoney(allotment.contribution.amount, allotment.currency)}</Fact>
              <Fact label={COPY.RECEIVED_ON}>{formatDate(allotment.contribution.receivedOn)}</Fact>
              <Fact label="Receipt attested">{formatDateTime(allotment.contribution.recordedAt)}</Fact>
              <Fact label={COPY.COMPANY_EVENT_ON}>{formatDate(allotment.companyEventOn, 'Not recorded')}</Fact>
              {!!allotment.registerEntry &&
                !!allotment.effectiveOn &&
                allotment.effectiveOn !== allotment.companyEventOn && (
                  <Fact label="Ledger date">{formatDate(allotment.effectiveOn)}</Fact>
                )}
              <Fact label={COPY.DIRECTOR}>{allotment.approvingDirector}</Fact>
            </Rows>
            <Text style={look.muted}>{COPY.RECEIPT_NOTE}</Text>
            {documentsView}
          </ShowMore>
        </View>
      )}
      <RegisterDecisions
        approveLabel="Review and approve"
        family={family}
        copy={DECISION_COPY}
        proposal={allotment}
        steps={decisionSteps}
        guard={guard}
        newEffectGuard={(kind) => {
          newEffectGuard(kind);
          if (kind === 'approve') {
            if (!steps.apply) throw new Error('Company authority to record share issues is required.');
            newEffectGuard('apply');
          }
        }}
        context={context}
        onDecided={onSettled}
        onRefused={onSettled}
        visible={visible}
        onHeldChange={onHeldChange}
        review={{
          onChange: reviewChanged,
          title: 'Review share issue',
          labels: { approve: 'Approve', apply: 'Approve', reject: 'Reject allotment' },
        }}
      >
        {(preview, kind) => (
          <AllotmentReview
            preview={preview}
            documents={documentsView}
            showOwnership={kind !== 'reject' && allotment.status === 'submitted' && !allotment.registerEntry}
          />
        )}
      </RegisterDecisions>
    </RecordShell>
  );
}

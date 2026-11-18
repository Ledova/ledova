import { useCallback, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import {
  REGISTER_TRANSFER_COPY as COPY,
  REGISTER_TRANSFER_DECISIONS,
  STAGE_TONES,
  TRANSFER_GROUPS,
  formatDate,
  formatDateTime,
  formatShortDate,
  recordGroup,
  shareCount,
  useTransferRecordDownload,
  type RegisterSteps,
  type RegisterTransfer,
  type RegisterTransferDecisionPreview,
  type RegisterTransferDecisionRequest,
} from '@ledova/shared';
import { Fact, Outcome, Rows, Section, Status } from '../../components/Ledger';
import { SHARE_SHEET_FILES } from '../../services/documentCopies';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { DocumentActions, RecordShell, RecordSummary, decisionTrail } from './IssueRecord';
import { Details, Group } from './IssueReviews';
import { RegisterDecisions } from './RegisterDecisions';
import { useLedgerStyles } from './useLedgerStyles';

const DECISION_COPY = { ...COPY, DECISIONS: { ...COPY.DECISIONS, approve: 'Approve', apply: 'Transfer recorded' } };
const DOCUMENTS = ['authority', 'instrument'] as const;

function TransferReview({
  preview,
  proposal,
  documents,
  showOwnership,
}: {
  preview: RegisterTransferDecisionPreview;
  proposal: Pick<RegisterTransfer, 'authorityReference' | 'reason'>;
  documents: ReactNode;
  showOwnership: boolean;
}) {
  const look = useLedgerStyles();
  const from = preview.fromName || 'Name not recorded';
  const to = preview.name || 'Name not recorded';
  return (
    <>
      <Section title="Transfer summary">
        <Rows>
          <Fact label="From">{from}</Fact>
          <Fact label="To">{to}</Fact>
          <Fact label="Shares">{shareCount(preview.shares)}</Fact>
        </Rows>
      </Section>
      {showOwnership && (
        <Section title="Ownership impact">
          <Rows>
            <Fact
              label={from}
            >{`${shareCount(preview.fromCurrentShares)} → ${shareCount(preview.fromAfterShares)}`}</Fact>
            <Fact label={to}>{`${shareCount(preview.toCurrentShares)} → ${shareCount(preview.toAfterShares)}`}</Fact>
            <Fact label="Issued shares">
              {`${shareCount(preview.issuedSupply)} → ${shareCount(preview.afterIssuedSupply)}`}
            </Fact>
          </Rows>
        </Section>
      )}
      <Section title="Company records">
        <View style={look.groups}>
          <Group title="Transfer instrument">
            <Fact label="Signed on">{formatDate(preview.signedOn, 'Not recorded')}</Fact>
            <Fact label="Lodged with company">{formatDate(preview.lodgedOn, 'Not recorded')}</Fact>
          </Group>
          <Group title="Company authority">
            <Fact label="Company transfer date">{formatDate(preview.companyEventOn, 'Not recorded')}</Fact>
            <Fact label="Approving director">{preview.approvingDirector}</Fact>
            <Fact label="Authority reference">{proposal.authorityReference}</Fact>
            <Fact label="Reason">{proposal.reason}</Fact>
          </Group>
        </View>
        <Details>
          <Rows>
            <Fact label="Transfer terms">{preview.terms}</Fact>
            <Fact label="Transferor residential address">{preview.fromResidentialAddress}</Fact>
            <Fact label="Recipient residential address">{preview.residentialAddress}</Fact>
            <Fact label="Recipient particulars">
              {preview.newParticulars ? 'Retained from the signed instrument' : 'Existing retained particulars'}
            </Fact>
            {!!preview.effectiveOn && preview.effectiveOn !== preview.companyEventOn && (
              <Fact label="Ledger date">{formatDate(preview.effectiveOn)}</Fact>
            )}
            <Fact label="Authorised supply">{shareCount(preview.authorisedSupply)}</Fact>
          </Rows>
          {documents}
        </Details>
      </Section>
    </>
  );
}

export function TransferRecord({
  transfer,
  steps,
  guard,
  onSettled,
  visible,
  onHeldChange,
  focusKey,
  onFocus,
  outcome,
  reviewing,
  onReviewChange,
  ruled,
  collapsed,
}: {
  transfer: RegisterTransfer;
  steps: RegisterSteps;
  guard: () => void;
  onSettled: () => Promise<unknown>;
  visible: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
  focusKey?: string;
  onFocus?: (record: View) => void;
  outcome?: string;
  reviewing: string | null;
  onReviewChange: (uuid: string, open: boolean) => void;
  ruled: boolean;
  collapsed: boolean;
}) {
  const look = useLedgerStyles();
  const download = useTransferRecordDownload(transfer, guard, SHARE_SHEET_FILES, orderSubmissionSession);
  const context = `transfer from ${transfer.fromName} to ${transfer.name} prepared ${formatDateTime(transfer.createdAt)}`;
  const decisionSteps = { ...steps, apply: undefined };
  const family = {
    ...REGISTER_TRANSFER_DECISIONS,
    request: (request: RegisterTransferDecisionRequest): RegisterTransferDecisionRequest =>
      request.kind === 'approve'
        ? { ...request, completeTransfer: true, applyAppointment: steps.apply?.uuid ?? request.appointment }
        : request,
  };
  const reviewChanged = useCallback(
    (open: boolean) => onReviewChange(transfer.uuid, open),
    [transfer.uuid, onReviewChange],
  );
  const inReview = reviewing === transfer.uuid;
  const documentsView = <DocumentActions kinds={DOCUMENTS} context={context} download={download} />;
  return (
    <RecordShell
      hidden={!visible || (reviewing ? !inReview : collapsed)}
      ruled={ruled && !reviewing}
      focusKey={focusKey}
      onFocus={onFocus}
    >
      {visible && (
        <View style={[look.summary, inReview && look.hidden]}>
          {!!outcome && transfer.stage === 'submitted' && <Outcome>{outcome}</Outcome>}
          <RecordSummary
            name={`${transfer.fromName || 'Name not recorded'} to ${transfer.name || 'Name not recorded'}`}
            figure={shareCount(transfer.shares)}
            facts={`Non-paid transfer · ${formatShortDate(transfer.companyEventOn, 'Date not recorded')}`}
            status={
              recordGroup(TRANSFER_GROUPS, transfer.stage) === 'decide'
                ? {
                    tone: STAGE_TONES[transfer.stage] ?? 'waiting',
                    label:
                      transfer.stage === 'approved'
                        ? 'Ready to complete'
                        : (COPY.STAGES[transfer.stage] ?? transfer.stage),
                  }
                : undefined
            }
          >
            <Rows>
              <Fact label="Stage">
                <Status tone={STAGE_TONES[transfer.stage] ?? 'waiting'}>
                  {COPY.STAGES[transfer.stage] ?? transfer.stage}
                </Status>
              </Fact>
              <Fact label="Prepared by">{transfer.preparedByName || 'Name not recorded'}</Fact>
              <Fact label="Prepared on">{formatDateTime(transfer.createdAt)}</Fact>
              <Fact label={COPY.AUTHORITY_REFERENCE}>{transfer.authorityReference}</Fact>
              <Fact label={COPY.REASON}>{transfer.reason}</Fact>
              {decisionTrail(transfer, DECISION_COPY.DECISIONS)}
            </Rows>
            <Rows>
              <Fact label={COPY.FROM}>{transfer.fromName || 'Name not recorded'}</Fact>
              <Fact label="Transferor residential address">{transfer.fromResidentialAddress}</Fact>
              <Fact label={COPY.TO}>{transfer.name || 'Name not recorded'}</Fact>
              <Fact label={COPY.ADDRESS}>{transfer.residentialAddress}</Fact>
              <Fact label="Recipient particulars">
                {transfer.newParticulars ? 'Retained from the signed instrument' : 'Existing retained particulars'}
              </Fact>
              <Fact label={COPY.SHARES}>{shareCount(transfer.shares)}</Fact>
              <Fact label={COPY.SIGNED_ON}>{formatDate(transfer.signedOn)}</Fact>
              <Fact label={COPY.LODGED_ON}>{formatDate(transfer.lodgedOn)}</Fact>
              <Fact label={COPY.COMPANY_EVENT_ON}>{formatDate(transfer.companyEventOn, 'Not recorded')}</Fact>
              {!!transfer.registerEntry &&
                !!transfer.effectiveOn &&
                transfer.effectiveOn !== transfer.companyEventOn && (
                  <Fact label="Ledger date">{formatDate(transfer.effectiveOn)}</Fact>
                )}
              <Fact label={COPY.TERMS}>{transfer.terms}</Fact>
              <Fact label={COPY.DIRECTOR}>{transfer.approvingDirector}</Fact>
            </Rows>
            <Text style={look.muted}>{COPY.PROVIDED_BY_COMPANY}</Text>
            {documentsView}
          </RecordSummary>
        </View>
      )}
      <RegisterDecisions
        approveLabel="Review and approve"
        family={family}
        copy={DECISION_COPY}
        proposal={transfer}
        steps={decisionSteps}
        guard={guard}
        newEffectGuard={(kind) => {
          guard();
          if (kind === 'approve' && !steps.apply)
            throw new Error('Company authority to record share transfers is required.');
        }}
        context={context}
        onDecided={onSettled}
        onRefused={onSettled}
        visible={visible}
        onHeldChange={onHeldChange}
        review={{
          onChange: reviewChanged,
          title: 'Review share transfer',
          labels: { approve: 'Approve', apply: 'Approve', reject: 'Reject transfer' },
        }}
      >
        {(preview, kind) => (
          <TransferReview
            preview={preview}
            proposal={transfer}
            documents={documentsView}
            showOwnership={kind !== 'reject'}
          />
        )}
      </RegisterDecisions>
    </RecordShell>
  );
}

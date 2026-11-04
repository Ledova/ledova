import { useCallback } from 'react';
import { RecordShell, RecordDownloadFailure, RecordStage } from '@pages/company/ledger/shared/RecordShell';
import { useRegisterTaskGuard } from './useRegisterTaskGuard';
import {
  REGISTER_TRANSFER_COPY as COPY,
  REGISTER_TRANSFER_DECISIONS,
  TRANSFER_GROUPS,
  formatDateTime,
  recordGroup,
  type RegisterTransfer,
  type RegisterTransferDecisionRequest,
  shareCount,
  formatDate,
  formatShortDate,
  STAGE_TONES,
  type RegisterSteps,
  useTransferRecordDownload,
} from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { DecisionTrail } from './DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { BROWSER_FILES } from '@utils/saveFile';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';
import { RecordSummary } from './RecordSummary';
import { TransferReview } from './TransferReview';

const DECISION_COPY = { ...COPY, DECISIONS: { ...COPY.DECISIONS, approve: 'Approve', apply: 'Transfer recorded' } };

function TransferRows({ transfer }: { transfer: RegisterTransfer }) {
  return (
    <Rows>
      <Row label={COPY.FROM}>{transfer.fromName || 'Name not recorded'}</Row>
      <Row label="Transferor residential address">{transfer.fromResidentialAddress}</Row>
      <Row label={COPY.TO}>{transfer.name || 'Name not recorded'}</Row>
      <Row label={COPY.ADDRESS}>{transfer.residentialAddress}</Row>
      <Row label="Recipient particulars">
        {transfer.newParticulars ? 'Retained from the signed instrument' : 'Existing retained particulars'}
      </Row>
      <Row label={COPY.SHARES}>{shareCount(transfer.shares)}</Row>
      <Row label={COPY.SIGNED_ON}>{formatDate(transfer.signedOn)}</Row>
      <Row label={COPY.LODGED_ON}>{formatDate(transfer.lodgedOn)}</Row>
      <Row label={COPY.COMPANY_EVENT_ON}>{formatDate(transfer.companyEventOn, 'Not recorded')}</Row>
      {'registerEntry' in transfer &&
        transfer.registerEntry &&
        transfer.effectiveOn &&
        transfer.effectiveOn !== transfer.companyEventOn && (
          <Row label="Ledger date">{formatDate(transfer.effectiveOn)}</Row>
        )}
      <Row label={COPY.TERMS}>{transfer.terms}</Row>
      <Row label={COPY.DIRECTOR}>{transfer.approvingDirector}</Row>
    </Rows>
  );
}

export function TransferRecord({
  landed,
  transfer,
  steps,
  guard,
  onSettled,
  visible = true,
  collapsed = false,
  ruled = false,
  onHeldChange,
  reviewTarget,
  onReviewChange,
}: {
  landed?: Landed;
  transfer: RegisterTransfer;
  steps: RegisterSteps;
  guard: () => void;
  onSettled: () => Promise<unknown>;
  visible?: boolean;
  collapsed?: boolean;
  ruled?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
  reviewTarget: HTMLElement | null;
  onReviewChange: (uuid: string, open: boolean) => void;
}) {
  const check = useRegisterTaskGuard(visible, guard);
  const download = useTransferRecordDownload(transfer, check, BROWSER_FILES);
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
  const documents = (
    <>
      <div className="flex flex-wrap gap-2">
        {(['authority', 'instrument'] as const).map((kind) => (
          <PageAction
            key={kind}
            label={`Download ${kind} document`}
            busy={download.isPending && download.variables === kind}
            busyLabel="Downloading…"
            context={context}
            disabled={download.isPending}
            onClick={() => download.mutate(kind)}
          />
        ))}
      </div>
      {download.isError && <RecordDownloadFailure error={download.error} />}
    </>
  );
  return (
    <RecordShell
      hidden={!visible || collapsed}
      ruled={ruled}
      focusKey={landed?.key}
      landed={transfer.stage === 'submitted' ? landed : undefined}
    >
      {visible && (
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
            <RecordStage stage={transfer.stage}>{COPY.STAGES[transfer.stage] ?? transfer.stage}</RecordStage>
            <Row label="Prepared by">{transfer.preparedByName || 'Name not recorded'}</Row>
            <Row label="Prepared on">{formatDateTime(transfer.createdAt)}</Row>
            <Row label={COPY.AUTHORITY_REFERENCE}>{transfer.authorityReference}</Row>
            <Row label={COPY.REASON}>{transfer.reason}</Row>
            <DecisionTrail proposal={transfer} labels={DECISION_COPY.DECISIONS} />
          </Rows>
          <TransferRows transfer={transfer} />
          <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
          {documents}
        </RecordSummary>
      )}
      <RegisterDecisions
        recordActions
        approveLabel="Review and approve"
        family={family}
        copy={DECISION_COPY}
        noun="non-paid transfer"
        proposal={transfer}
        steps={decisionSteps}
        guard={guard}
        newEffectGuard={(kind) => {
          check();
          if (kind === 'approve' && !steps.apply)
            throw new Error('Company authority to record share transfers is required.');
        }}
        visible={visible}
        onHeldChange={onHeldChange}
        context={context}
        onDecided={onSettled}
        onRefused={onSettled}
        pageReview={{
          target: reviewTarget,
          onChange: reviewChanged,
          title: 'Review share transfer',
          labels: { approve: 'Approve', apply: 'Approve', reject: 'Reject transfer' },
        }}
      >
        {(preview, kind) => (
          <TransferReview
            preview={preview}
            proposal={transfer}
            documents={documents}
            showOwnership={kind !== 'reject'}
          />
        )}
      </RegisterDecisions>
    </RecordShell>
  );
}

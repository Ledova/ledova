import { useCallback, type ReactNode } from 'react';
import { RecordShell, RecordDownloadFailure, RecordStage } from '@pages/company/ledger/shared/RecordShell';
import { useRegisterTaskGuard } from './useRegisterTaskGuard';
import {
  REGISTER_TRANSFER_COPY as COPY,
  REGISTER_TRANSFER_DECISIONS,
  formatDateTime,
  type RegisterTransfer,
  type RegisterTransferDecisionRequest,
  shareCount,
  formatDate,
} from '@ledova/shared';
import { Row, Rows, Status, ShowMore } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { DecisionTrail } from './DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { STAGE_TONES, type RegisterSteps } from '@pages/company/shared/proposals';
import { useTransferRecordDownload } from './useRegisterRecordDownload';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';
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
  onHeldChange,
  prepareAction,
  reviewTarget,
  onReviewChange,
}: {
  landed?: Landed;
  transfer: RegisterTransfer;
  steps: RegisterSteps;
  guard: () => void;
  onSettled: () => Promise<unknown>;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
  prepareAction?: ReactNode;
  reviewTarget: HTMLElement | null;
  onReviewChange: (uuid: string, open: boolean) => void;
}) {
  const check = useRegisterTaskGuard(visible, guard);
  const download = useTransferRecordDownload(transfer, check);
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
    <RecordShell hidden={!visible} focusKey={landed?.key} landed={transfer.stage === 'submitted' ? landed : undefined}>
      {visible && (
        <>
          <h3 className="sr-only">
            Transfer from {transfer.fromName || 'Name not recorded'} to {transfer.name || 'Name not recorded'}
          </h3>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <div className="min-w-0 space-y-1">
              <dt className="text-text-muted">From</dt>
              <dd className="break-words font-medium">{transfer.fromName || 'Name not recorded'}</dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-text-muted">To</dt>
              <dd className="break-words font-medium">{transfer.name || 'Name not recorded'}</dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-text-muted">Shares</dt>
              <dd className="break-words font-medium tabular-nums">{shareCount(transfer.shares)}</dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-text-muted">Transfer date</dt>
              <dd className="break-words font-medium tabular-nums">
                {formatDate(transfer.companyEventOn, 'Not recorded')}
              </dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-text-muted">Status</dt>
              <dd>
                <Status tone={STAGE_TONES[transfer.stage] ?? 'waiting'}>
                  {transfer.stage === 'applied'
                    ? 'Approved'
                    : transfer.stage === 'approved'
                      ? 'Ready to complete'
                      : (COPY.STAGES[transfer.stage] ?? transfer.stage)}
                </Status>
              </dd>
            </div>
          </dl>
          <ShowMore show="Show details and documents" hide="Hide details and documents">
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
          </ShowMore>
        </>
      )}
      <RegisterDecisions
        recordActions
        leadingAction={prepareAction}
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

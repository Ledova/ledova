import { RecordShell, RecordDownloadFailure, RecordStage } from './RecordShell';
import { useRegisterTaskGuard } from './useRegisterTaskGuard';
import {
  REGISTER_TRANSFER_COPY as COPY,
  REGISTER_TRANSFER_DECISIONS,
  formatDateTime,
  type RegisterTransfer,
  type RegisterTransferDecisionPreview,
  shareCount,
  formatDate,
  shortReference,
} from '@ledova/shared';
import { Row, Rows, Status, Disclosure } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { DecisionTrail } from '@pages/company/ledger/shared/DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { STAGE_TONES, type RegisterSteps } from '@pages/company/shared/proposals';
import { useTransferRecordDownload } from './useRegisterRecordDownload';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';

function TransferRows({ transfer }: { transfer: RegisterTransfer | RegisterTransferDecisionPreview }) {
  return (
    <Rows>
      <Row label={COPY.FROM}>{transfer.fromName || shortReference(transfer.fromMember)}</Row>
      <Row label="Transferor residential address">{transfer.fromResidentialAddress}</Row>
      <Row label={COPY.TO}>{transfer.name || shortReference(transfer.toMember)}</Row>
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
}: {
  landed?: Landed;
  transfer: RegisterTransfer;
  steps: RegisterSteps;
  guard: () => void;
  onSettled: () => Promise<unknown>;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
}) {
  const check = useRegisterTaskGuard(visible, guard);
  const download = useTransferRecordDownload(transfer, check);
  const context = `transfer from ${transfer.fromName} to ${transfer.name} prepared ${formatDateTime(transfer.createdAt)}`;
  return (
    <RecordShell hidden={!visible} landed={landed}>
      {visible && (
        <>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="break-words text-base font-medium">
                {transfer.fromName || shortReference(transfer.fromMember)} →{' '}
                {transfer.name || shortReference(transfer.toMember)}
              </h4>
              <Status tone={STAGE_TONES[transfer.stage] ?? 'waiting'}>
                {COPY.STAGES[transfer.stage] ?? transfer.stage}
              </Status>
            </div>
            <p className="text-sm text-text-muted">
              {shareCount(transfer.shares)} ·{' '}
              {formatDate(transfer.companyEventOn, 'Company transfer date not recorded')}
            </p>
          </div>
          <p className="text-sm text-text-muted">
            {transfer.stage === 'applied'
              ? 'Shares transferred. Issued shares are unchanged.'
              : transfer.stage === 'approved'
                ? 'Approved. The transfer has not been applied.'
                : transfer.stage === 'rejected'
                  ? 'Rejected. No shares transferred.'
                  : 'Ready for approval. No shares transferred.'}
          </p>
          <Disclosure summary="Details and documents">
            <Rows>
              <RecordStage stage={transfer.stage}>{COPY.STAGES[transfer.stage] ?? transfer.stage}</RecordStage>
              <Row label="Prepared by">{transfer.preparedByName || 'Name not recorded'}</Row>
              <Row label="Prepared on">{formatDateTime(transfer.createdAt)}</Row>
              <Row label={COPY.AUTHORITY_REFERENCE}>{transfer.authorityReference}</Row>
              <Row label={COPY.REASON}>{transfer.reason}</Row>
              <DecisionTrail proposal={transfer} labels={COPY.DECISIONS} />
              {!!transfer.registerEntry && <Row label="Register entry">{shortReference(transfer.registerEntry)}</Row>}
            </Rows>
            <TransferRows transfer={transfer} />
            <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
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
          </Disclosure>
        </>
      )}
      <RegisterDecisions
        recordActions
        primaryAction={transfer.stage === 'approved' ? 'apply' : 'approve'}
        approveLabel="Review and approve"
        family={REGISTER_TRANSFER_DECISIONS}
        copy={COPY}
        noun="non-paid transfer"
        proposal={transfer}
        steps={steps}
        guard={guard}
        newEffectGuard={check}
        visible={visible}
        onHeldChange={onHeldChange}
        context={context}
        onDecided={onSettled}
        onRefused={onSettled}
      >
        {(preview) => (
          <>
            <TransferRows transfer={preview} />
            <p className="text-sm text-text-muted">{COPY.EFFECTIVE_NOTE}</p>
            <Rows>
              <Row label="Register sequence">{preview.registerSequence}</Row>
              <Row label="Transferor holding">
                {shareCount(preview.fromCurrentShares)} → {shareCount(preview.fromAfterShares)}
              </Row>
              <Row label="Recipient holding">
                {shareCount(preview.toCurrentShares)} → {shareCount(preview.toAfterShares)}
              </Row>
              <Row label="Issued supply">
                {shareCount(preview.issuedSupply)} → {shareCount(preview.afterIssuedSupply)}
              </Row>
              <Row label="Authorised supply">{shareCount(preview.authorisedSupply)}</Row>
            </Rows>
          </>
        )}
      </RegisterDecisions>
    </RecordShell>
  );
}

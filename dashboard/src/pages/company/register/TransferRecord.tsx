import { useMutation } from '@tanstack/react-query';
import {
  REGISTER_TRANSFER_COPY as COPY,
  REGISTER_TRANSFER_DECISIONS,
  apiErrorSentence,
  downloadRegisterTransferFile,
  formatDateTime,
  type RegisterTransfer,
  type RegisterTransferDecisionPreview,
} from '@ledova/shared';
import { Row, Rows, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { DecisionTrail } from './DecisionTrail';
import { RegisterDecisions } from './RegisterDecisions';
import { DOWNLOAD_FAILED, STAGE_TONES, retainedName, shareCount, type RegisterSteps } from './proposals';
import { saveFile } from './useCompanyRegister';

function TransferRows({ transfer }: { transfer: RegisterTransfer | RegisterTransferDecisionPreview }) {
  return (
    <Rows>
      <Row label={COPY.FROM}>
        {transfer.fromName} · {transfer.fromMember}
      </Row>
      <Row label="Transferor residential address">{transfer.fromResidentialAddress}</Row>
      <Row label={COPY.TO}>
        {transfer.name} · {transfer.toMember}
      </Row>
      <Row label={COPY.ADDRESS}>{transfer.residentialAddress}</Row>
      <Row label="Recipient particulars">
        {transfer.newParticulars ? 'Retained from the signed instrument' : 'Existing retained particulars'}
      </Row>
      <Row label={COPY.SHARES}>{shareCount(transfer.shares)}</Row>
      <Row label={COPY.SIGNED_ON}>{transfer.signedOn}</Row>
      <Row label={COPY.LODGED_ON}>{transfer.lodgedOn}</Row>
      <Row label="Register entry date">{transfer.effectiveOn || 'Recorded on application'}</Row>
      <Row label={COPY.TERMS}>{transfer.terms}</Row>
      <Row label={COPY.DIRECTOR}>{transfer.approvingDirector}</Row>
    </Rows>
  );
}

export function TransferRecord({
  transfer,
  steps,
  guard,
  onSettled,
}: {
  transfer: RegisterTransfer;
  steps: RegisterSteps;
  guard: () => void;
  onSettled: () => Promise<unknown>;
}) {
  const download = useMutation({
    mutationFn: async (kind: 'authority' | 'instrument') => {
      guard();
      const { data } = await downloadRegisterTransferFile(apiClient, transfer.uuid, kind, {
        ledovaSubmissionGuard: guard,
      });
      guard();
      saveFile(
        data,
        retainedName(
          kind === 'authority' ? transfer.evidenceSnapshot : transfer.instrumentSnapshot,
          `${kind}-${transfer.uuid}`,
        ),
      );
    },
  });
  const context = `transfer from ${transfer.fromName} to ${transfer.name} prepared ${formatDateTime(transfer.createdAt)}`;
  return (
    <li className="flex flex-col gap-3 py-4">
      <Rows>
        <Row label="Stage">
          <Status tone={STAGE_TONES[transfer.stage] ?? 'waiting'}>
            {COPY.STAGES[transfer.stage] ?? transfer.stage}
          </Status>
        </Row>
        <Row label="Prepared by">{transfer.preparedByName || 'Name not recorded'}</Row>
        <Row label="Prepared on">{formatDateTime(transfer.createdAt)}</Row>
        <Row label={COPY.AUTHORITY_REFERENCE}>{transfer.authorityReference}</Row>
        <Row label={COPY.REASON}>{transfer.reason}</Row>
        <DecisionTrail proposal={transfer} labels={COPY.DECISIONS} />
        {!!transfer.registerEntry && <Row label="Register entry">{transfer.registerEntry}</Row>}
      </Rows>
      <TransferRows transfer={transfer} />
      <p className="text-sm text-text-muted">{COPY.PROVIDED_BY_COMPANY}</p>
      <div className="flex flex-wrap gap-2">
        {(['authority', 'instrument'] as const).map((kind) => (
          <PageAction
            key={kind}
            label={`Download ${kind} document`}
            context={context}
            disabled={download.isPending}
            onClick={() => download.mutate(kind)}
          />
        ))}
      </div>
      {download.isError && (
        <p role="alert" className="text-sm text-error-light">
          {apiErrorSentence(download.error, DOWNLOAD_FAILED, DOWNLOAD_FAILED)}
        </p>
      )}
      <RegisterDecisions
        family={REGISTER_TRANSFER_DECISIONS}
        copy={COPY}
        noun="non-paid transfer"
        proposal={transfer}
        steps={steps}
        guard={guard}
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
    </li>
  );
}

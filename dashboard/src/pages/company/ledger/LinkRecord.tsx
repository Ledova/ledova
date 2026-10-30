import { RecordShell, RecordDownloadFailure, RecordStage } from '@pages/company/ledger/shared/RecordShell';
import { useRegisterTaskGuard } from './useRegisterTaskGuard';
import {
  REGISTER_LINK_COPY,
  REGISTER_LINK_DECISIONS,
  formatDateTime,
  registerLinkMemberLabels,
  type RegisterLink,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { DecisionTrail } from '@pages/company/ledger/shared/DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { WalletStatus } from '@pages/company/ledger/shared/WalletStatus';
import { type RegisterSteps } from '@pages/company/shared/proposals';
import { useLinkRecordDownload } from './useRegisterRecordDownload';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';

const COPY = REGISTER_LINK_COPY;

export function LinkRecord({
  landed,
  link,
  holders,
  steps,
  guard,
  onDecided,
  onRefused,
  visible = true,
  onHeldChange,
}: {
  landed?: Landed;
  link: RegisterLink;
  holders: TokenHoldersResponse['holders'];
  steps: RegisterSteps;
  guard: () => void;
  onDecided: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
}) {
  const check = useRegisterTaskGuard(visible, guard);
  const download = useLinkRecordDownload(link, check);
  const labels = registerLinkMemberLabels(link.mappingSummary, holders);
  const context = `wallet link prepared ${formatDateTime(link.createdAt)}`;
  const downloadAction = (
    <PageAction
      label={COPY.DOWNLOAD}
      context={context}
      busy={download.isPending}
      busyLabel="Downloading…"
      onClick={() => download.mutate()}
    />
  );
  return (
    <RecordShell hidden={!visible} landed={landed}>
      {visible && (
        <>
          <h3 className="font-medium text-text-primary">Wallet link</h3>
          <Rows>
            <RecordStage stage={link.stage}>{COPY.STAGES[link.stage] ?? link.stage}</RecordStage>
            {link.preparedByName !== null && <Row label="Prepared by">{link.preparedByName || 'Not provided'}</Row>}
            <Row label="Prepared on">{formatDateTime(link.createdAt)}</Row>
          </Rows>
          <div className="flex flex-col gap-1">
            <p className="text-sm text-text-muted">{COPY.WALLETS}</p>
            <ul className="divide-y divide-border-subtle">
              {link.mappingSummary.map((row) => (
                <li key={row.address} className="flex flex-col gap-1 py-2">
                  <span className="min-w-0 break-words text-sm text-text-primary">{labels.get(row.member)}</span>
                  <span className="break-all text-xs text-text-muted">{row.address}</span>
                </li>
              ))}
            </ul>
          </div>
          <Rows>
            <Row label={COPY.AUTHORITY}>{COPY.AUTHORITIES[link.authority] ?? link.authority}</Row>
            {link.approvingDirector && <Row label={COPY.APPROVING_DIRECTOR}>{link.approvingDirector}</Row>}
            <Row label={COPY.AUTHORITY_REFERENCE}>{link.authorityReference}</Row>
            <Row label={COPY.REASON}>{link.reason}</Row>
            <Row label="Evidence">{link.providedBy === 'company' ? COPY.PROVIDED_BY_COMPANY : COPY.STAFF_VERIFIED}</Row>
            <DecisionTrail proposal={link} labels={COPY.DECISIONS} />
          </Rows>
        </>
      )}
      <FormActions>
        {downloadAction}
        <RegisterDecisions
          family={REGISTER_LINK_DECISIONS}
          copy={COPY}
          noun="wallet link"
          proposal={link}
          steps={steps}
          guard={guard}
          newEffectGuard={check}
          visible={visible}
          onHeldChange={onHeldChange}
          context={context}
          onDecided={onDecided}
          onRefused={onRefused}
          note={(kind) => kind === 'apply' && <p className="text-sm text-text-muted">{COPY.APPLY_NOTE}</p>}
        >
          {(preview) => {
            const previewed = registerLinkMemberLabels(preview.links, holders);
            return (
              <div className="flex flex-col gap-1">
                <p className="text-sm text-text-muted">{COPY.STATUS_NOTE}</p>
                <ul className="divide-y divide-border-subtle">
                  {preview.links.map((row) => (
                    <li key={row.address} className="flex flex-col gap-1 py-2">
                      <span className="min-w-0 break-words text-sm text-text-primary">{previewed.get(row.member)}</span>
                      <span className="break-all text-xs text-text-muted">{row.address}</span>
                      <WalletStatus wallet={row} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          }}
        </RegisterDecisions>
      </FormActions>
      {download.isError && <RecordDownloadFailure error={download.error} />}
    </RecordShell>
  );
}

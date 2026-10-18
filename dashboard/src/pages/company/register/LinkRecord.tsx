import { RecordShell, RecordDownloadFailure, RecordStage } from './RecordShell';
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
import { PageAction } from '@components/Page';
import { DecisionTrail } from '@pages/company/register/shared/DecisionTrail';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { WalletStatus } from '@pages/company/register/shared/WalletStatus';
import { type RegisterSteps } from '@pages/company/shared/proposals';
import { useLinkRecordDownload } from './useRegisterRecordDownload';

const COPY = REGISTER_LINK_COPY;

export function LinkRecord({
  link,
  holders,
  steps,
  guard,
  onDecided,
  onRefused,
  visible = true,
  onHeldChange,
}: {
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
  return (
    <RecordShell hidden={!visible}>
      {visible && (
        <details open={link.status === 'submitted'} className="space-y-3">
          <summary className="cursor-pointer text-sm font-medium text-text-primary">{`Wallet link · ${formatDateTime(link.createdAt)} · ${COPY.STAGES[link.stage] ?? link.stage}`}</summary>
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
            <DecisionTrail proposal={link} labels={COPY.DECISIONS} />
          </Rows>
          <p className="text-sm text-text-muted">
            {link.providedBy === 'company' ? COPY.PROVIDED_BY_COMPANY : COPY.STAFF_VERIFIED}
          </p>
          <div className="flex flex-wrap gap-2">
            <PageAction
              label={COPY.DOWNLOAD}
              context={context}
              disabled={download.isPending}
              onClick={() => download.mutate()}
            />
          </div>
          {download.isError && <RecordDownloadFailure error={download.error} />}
        </details>
      )}
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
    </RecordShell>
  );
}

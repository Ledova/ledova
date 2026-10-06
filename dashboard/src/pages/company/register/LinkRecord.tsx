import { useMutation } from '@tanstack/react-query';
import {
  REGISTER_LINK_COPY,
  REGISTER_LINK_DECISIONS,
  apiErrorSentence,
  downloadRegisterLinkFile,
  formatDateTime,
  type RegisterLink,
} from '@ledova/shared';
import { Row, Rows, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { DecisionTrail } from './DecisionTrail';
import { RegisterDecisions } from './RegisterDecisions';
import { WalletStatus } from './WalletStatus';
import { DOWNLOAD_FAILED, STAGE_TONES, retainedName, type RegisterSteps } from './proposals';
import { saveFile } from './useCompanyRegister';

const COPY = REGISTER_LINK_COPY;

export function LinkRecord({
  link,
  names,
  steps,
  guard,
  onDecided,
  onRefused,
}: {
  link: RegisterLink;
  names: Map<string, string | null>;
  steps: RegisterSteps;
  guard: () => void;
  onDecided: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
}) {
  const download = useMutation({
    mutationFn: async () => {
      guard();
      const { data } = await downloadRegisterLinkFile(apiClient, link.uuid, { ledovaSubmissionGuard: guard });
      guard();
      saveFile(data, retainedName(link.evidenceSnapshot, `wallet-link-${link.uuid}`));
    },
  });
  const memberOf = ({ member, memberExists }: { member: string; memberExists: boolean }) =>
    names.get(member) || (memberExists ? COPY.EXISTING_MEMBER : COPY.NEW_MEMBER);
  const context = `wallet link prepared ${formatDateTime(link.createdAt)}`;
  return (
    <li className="flex flex-col gap-3 py-4">
      <Rows>
        <Row label="Stage">
          <Status tone={STAGE_TONES[link.stage] ?? 'waiting'}>{COPY.STAGES[link.stage] ?? link.stage}</Status>
        </Row>
        {link.preparedByName !== null && <Row label="Prepared by">{link.preparedByName || 'Not provided'}</Row>}
        <Row label="Prepared on">{formatDateTime(link.createdAt)}</Row>
      </Rows>
      <div className="flex flex-col gap-1">
        <p className="text-sm text-text-muted">{COPY.WALLETS}</p>
        <ul className="divide-y divide-border-subtle">
          {link.mappingSummary.map((row) => (
            <li key={row.address} className="flex flex-col gap-1 py-2">
              <span className="min-w-0 break-words text-sm text-text-primary">{memberOf(row)}</span>
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
      {download.isError && (
        <p role="alert" className="text-sm text-error-light">
          {apiErrorSentence(download.error, DOWNLOAD_FAILED, DOWNLOAD_FAILED)}
        </p>
      )}
      <RegisterDecisions
        family={REGISTER_LINK_DECISIONS}
        copy={COPY}
        noun="wallet link"
        proposal={link}
        steps={steps}
        guard={guard}
        context={context}
        onDecided={onDecided}
        onRefused={onRefused}
        note={(kind) => kind === 'apply' && <p className="text-sm text-text-muted">{COPY.APPLY_NOTE}</p>}
      >
        {(preview) => (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-text-muted">{COPY.STATUS_NOTE}</p>
            <ul className="divide-y divide-border-subtle">
              {preview.links.map((row) => (
                <li key={row.address} className="flex flex-col gap-1 py-2">
                  <span className="min-w-0 break-words text-sm text-text-primary">{memberOf(row)}</span>
                  <span className="break-all text-xs text-text-muted">{row.address}</span>
                  <WalletStatus wallet={row} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </RegisterDecisions>
    </li>
  );
}

import { useMutation } from '@tanstack/react-query';
import {
  REGISTER_OPENING_COPY,
  REGISTER_OPENING_DECISIONS,
  apiErrorSentence,
  downloadRegisterOpeningFile,
  formatDateTime,
  type RegisterOpening,
} from '@ledova/shared';
import { Row, Rows, Status } from '@components/Ledger';
import { PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { DecisionTrail } from './DecisionTrail';
import { RegisterChanges } from './RegisterChanges';
import { RegisterDecisions } from './RegisterDecisions';
import { DOWNLOAD_FAILED, STAGE_TONES, retainedName, shareCount, type RegisterSteps } from './proposals';
import { saveFile } from './useCompanyRegister';
import { openingHoldings } from './useRegisterOpenings';

const COPY = REGISTER_OPENING_COPY;

export function OpeningRecord({
  proposal,
  steps,
  guard,
  onDecided,
  onRefused,
}: {
  proposal: RegisterOpening;
  steps: RegisterSteps;
  guard: () => void;
  onDecided: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
}) {
  const download = useMutation({
    mutationFn: async () => {
      guard();
      const { data } = await downloadRegisterOpeningFile(apiClient, proposal.uuid, { ledovaSubmissionGuard: guard });
      guard();
      saveFile(data, retainedName(proposal.evidenceSnapshot, `register-opening-${proposal.uuid}`));
    },
  });
  const summary = proposal.boundarySummary;
  const mapped = summary ? openingHoldings(summary) : null;
  const context = `opening prepared ${formatDateTime(proposal.createdAt)}`;
  return (
    <li className="flex flex-col gap-3 py-4">
      <Rows>
        <Row label="Stage">
          <Status tone={STAGE_TONES[proposal.stage] ?? 'waiting'}>
            {COPY.STAGES[proposal.stage] ?? proposal.stage}
          </Status>
        </Row>
        {proposal.preparedByName !== null && <Row label="Prepared by">{proposal.preparedByName || 'Not provided'}</Row>}
        <Row label="Prepared on">{formatDateTime(proposal.createdAt)}</Row>
        <Row label={COPY.BOUNDARY}>
          {summary ? COPY.BOUNDARY_BLOCK(summary.blockNumber, summary.date) : 'Not captured'}
        </Row>
      </Rows>
      {mapped && (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-text-muted">{COPY.HOLDINGS}</p>
          {mapped.holdings.length === 0 ? (
            <p className="text-sm text-text-primary">{COPY.NO_HOLDINGS}</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {mapped.holdings.map((holding) => (
                <li key={holding.address} className="flex flex-col gap-1 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words text-sm text-text-primary">{holding.name}</span>
                    <span className="ml-auto break-all text-right text-sm tabular-nums text-text-primary">
                      {shareCount(holding.shares)}
                    </span>
                  </div>
                  <span className="break-all text-xs text-text-muted">{holding.address}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Rows>
        <Row label={COPY.AUTHORITY}>{COPY.AUTHORITIES[proposal.authority] ?? proposal.authority}</Row>
        {proposal.approvingDirector && <Row label={COPY.APPROVING_DIRECTOR}>{proposal.approvingDirector}</Row>}
        <Row label={COPY.AUTHORITY_REFERENCE}>{proposal.authorityReference}</Row>
        <Row label={COPY.REASON}>{proposal.reason}</Row>
        <DecisionTrail proposal={proposal} labels={COPY.DECISIONS} />
      </Rows>
      <p className="text-sm text-text-muted">
        {proposal.providedBy === 'company' ? COPY.PROVIDED_BY_COMPANY : COPY.STAFF_VERIFIED}
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
        family={REGISTER_OPENING_DECISIONS}
        copy={COPY}
        noun="opening"
        proposal={proposal}
        steps={steps}
        guard={guard}
        context={context}
        onDecided={onDecided}
        onRefused={onRefused}
        note={(kind) => kind === 'apply' && <p className="text-sm text-text-muted">{COPY.HOLDINGS_NOTE}</p>}
      >
        {(preview) =>
          preview.effectiveOn !== null && (
            <Rows>
              <Row label="Effective on">{preview.effectiveOn}</Row>
              <Row label="Opening entry">
                {preview.changes.length === 0 ? (
                  COPY.NO_HOLDINGS
                ) : (
                  <RegisterChanges
                    changes={preview.changes.map((change) => ({
                      ...change,
                      name: mapped?.names.get(change.member) ?? COPY.NEW_MEMBER,
                    }))}
                  />
                )}
              </Row>
            </Rows>
          )
        }
      </RegisterDecisions>
    </li>
  );
}

import { RecordShell, RecordDownloadFailure, RecordStage } from '@pages/company/ledger/shared/RecordShell';
import { useRegisterTaskGuard } from './useRegisterTaskGuard';
import {
  REGISTER_OPENING_COPY,
  REGISTER_OPENING_DECISIONS,
  formatDateTime,
  largestHoldingsFirst,
  openingMemberLabels,
  type RegisterOpening,
  shareCount,
  formatDate,
} from '@ledova/shared';
import { Row, Rows, ShowMore } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { DecisionTrail } from '@pages/company/ledger/shared/DecisionTrail';
import { RegisterChanges } from '@pages/company/ledger/shared/RegisterChanges';
import { RegisterDecisions } from '@pages/company/shared/RegisterDecisions';
import { type RegisterSteps } from '@pages/company/shared/proposals';
import { useOpeningRecordDownload } from './useRegisterRecordDownload';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';
import { registerInclusionMessage } from './shared/inclusionMessage';

const COPY = REGISTER_OPENING_COPY;

export function OpeningRecord({
  landed,
  proposal,
  steps,
  guard,
  onDecided,
  onRefused,
  visible = true,
  onHeldChange,
}: {
  landed?: Landed;
  proposal: RegisterOpening;
  steps: RegisterSteps;
  guard: () => void;
  onDecided: () => Promise<unknown>;
  onRefused: () => Promise<unknown>;
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
}) {
  const check = useRegisterTaskGuard(visible, guard);
  const download = useOpeningRecordDownload(proposal, check);
  const summary = proposal.boundarySummary;
  const holdings = summary ? largestHoldingsFirst(summary.holdings) : [];
  const labels = openingMemberLabels(holdings);
  const context = `opening prepared ${formatDateTime(proposal.createdAt)}`;
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
          <h4 className="text-sm font-medium text-text-primary">Chain opening</h4>
          <Rows>
            <RecordStage stage={proposal.stage}>{COPY.STAGES[proposal.stage] ?? proposal.stage}</RecordStage>
            {proposal.preparedByName !== null && (
              <Row label="Prepared by">{proposal.preparedByName || 'Not provided'}</Row>
            )}
            <Row label="Prepared on">{formatDateTime(proposal.createdAt)}</Row>
            <Row label={COPY.HOLDINGS_READ_ON}>{summary ? formatDate(summary.date) : 'Not captured'}</Row>
          </Rows>
          {summary && (
            <div className="flex flex-col gap-1">
              {holdings.length === 0 ? (
                <p className="text-sm text-text-primary">{COPY.NO_HOLDINGS}</p>
              ) : (
                <ShowMore
                  show={`Show the holdings (${holdings.length})`}
                  hide="Hide the holdings"
                  defaultOpen={proposal.status === 'submitted'}
                >
                  <ul className="divide-y divide-border-subtle">
                    {holdings.map((holding) => (
                      <li key={holding.address} className="flex flex-col gap-1 py-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="min-w-0 break-words text-sm text-text-primary">
                            {(holding.member !== null && labels.get(holding.member)) || COPY.NEW_MEMBER}
                          </span>
                          <span className="ml-auto break-all text-right text-sm tabular-nums text-text-primary">
                            {shareCount(holding.shares)}
                          </span>
                        </div>
                        <span className="break-all text-xs text-text-muted">{holding.address}</span>
                      </li>
                    ))}
                  </ul>
                </ShowMore>
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
        </>
      )}
      <FormActions>
        {downloadAction}
        <RegisterDecisions
          family={REGISTER_OPENING_DECISIONS}
          copy={COPY}
          noun="opening"
          proposal={proposal}
          steps={steps}
          guard={guard}
          newEffectGuard={check}
          visible={visible}
          onHeldChange={onHeldChange}
          context={context}
          onDecided={onDecided}
          onRefused={onRefused}
          formatError={registerInclusionMessage}
          note={(kind) => kind === 'apply' && <p className="text-sm text-text-muted">{COPY.HOLDINGS_NOTE}</p>}
        >
          {(preview) =>
            preview.effectiveOn !== null && (
              <Rows>
                <Row label="Effective on">{formatDate(preview.effectiveOn)}</Row>
                <Row label="Opening entry">
                  {preview.changes.length === 0 ? (
                    COPY.NO_HOLDINGS
                  ) : (
                    <RegisterChanges
                      changes={preview.changes.map((change) => ({
                        ...change,
                        name: labels.get(change.member) ?? COPY.NEW_MEMBER,
                      }))}
                    />
                  )}
                </Row>
              </Rows>
            )
          }
        </RegisterDecisions>
      </FormActions>
      {download.isError && <RecordDownloadFailure error={download.error} />}
    </RecordShell>
  );
}

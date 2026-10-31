import { useState } from 'react';
import { DESTINATIONS, formatDate, failureSentence } from '@ledova/shared';
import type { InvestorCategory, InvestorClassification } from '@ledova/shared';
import { LinkRow, Row, Rows, Section, Status, type Tone, LoadError, Loading } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { Confirmation } from '@components/Modal';
import { useInvestorWithdrawal } from './useInvestorWithdrawal';
import { CATEGORIES } from './constants';
import { ClaimModal } from './ClaimModal';
import { useInvestorEligibility } from './useInvestorEligibility';
import { DocumentsPanel } from './DocumentsPanel';

const CLASSIFICATION_TONES = new Map<string, Tone>([['submitted', 'moving']]);

function claimState(classification: InvestorClassification): { label: string; tone: Tone } {
  const tone = CLASSIFICATION_TONES.get(classification.status) ?? 'closed';
  if (classification.status === 'submitted') return { label: 'Available to share', tone };
  if (classification.status === 'verified')
    return {
      label: classification.isExpired ? 'Historical verification expired' : 'Historical verification',
      tone,
    };
  return { label: classification.statusDisplay, tone };
}

export default function InvestorEligibilityPage() {
  const { classifications, isLoading, hasError, isRefreshing, retry, refresh } = useInvestorEligibility();
  const [claimCategory, setClaimCategory] = useState<InvestorCategory | null>(null);

  const withdraw = useInvestorWithdrawal(refresh);
  const [withdrawing, setWithdrawing] = useState<InvestorClassification | null>(null);

  const submittedCategories = new Set(
    classifications.filter((claim) => claim.status === 'submitted').map((claim) => claim.category),
  );
  const submissionBlockedReason = hasError
    ? 'Your verification could not be loaded.'
    : isLoading || isRefreshing
      ? 'Refreshing your verification before continuing.'
      : null;

  return (
    <>
      <Page>
        {isLoading ? (
          <Loading>Loading your verification…</Loading>
        ) : hasError ? (
          <LoadError retry={retry} busy={isRefreshing}>
            Your verification could not be loaded.
          </LoadError>
        ) : (
          <>
            <Section title="Your claims">
              <LinkRow to={DESTINATIONS.eligibilityRequests.path} label={DESTINATIONS.eligibilityRequests.title} />
              {withdraw.isError && (
                <p role="alert" className="py-2 text-sm text-error-light">
                  {failureSentence(withdraw.error, 'Your claim could not be withdrawn. Try again.')}
                </p>
              )}
              {classifications.length === 0 ? (
                <p className="py-3 text-sm text-text-muted">No claims yet. Choose a category below.</p>
              ) : (
                <div className="divide-y divide-border-subtle">
                  {classifications.map((claim) => {
                    const state = claimState(claim);
                    return (
                      <article key={claim.uuid} className="min-w-0 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 basis-48">
                            <h3 className="break-words text-sm font-medium text-text-primary">
                              {claim.categoryDisplay}
                            </h3>
                            <p className="mt-1 text-sm text-text-muted">
                              <Status tone={state.tone}>{state.label}</Status>
                            </p>
                          </div>
                          {claim.status === 'submitted' && (
                            <div className="ml-auto">
                              <PageAction
                                label="Withdraw claim"
                                busy={withdraw.isPending && withdraw.variables === claim.uuid}
                                busyLabel="Withdrawing…"
                                onClick={() => setWithdrawing(claim)}
                                disabled={withdraw.isPending}
                              />
                            </div>
                          )}
                        </div>
                        <Rows>
                          {claim.submittedAt && <Row label="Submitted">{formatDate(claim.submittedAt)}</Row>}
                          {claim.reviewedAt && <Row label="Reviewed">{formatDate(claim.reviewedAt)}</Row>}
                          {claim.expiresAt && <Row label="Expires">{formatDate(claim.expiresAt)}</Row>}
                        </Rows>
                        {claim.rejectionReason && (
                          <p className="pt-2 text-sm text-text-muted">{claim.rejectionReason}</p>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title="How you qualify">
              <div className="divide-y divide-border-subtle">
                {CATEGORIES.map((item) => (
                  <div key={item.category} className="flex flex-wrap items-start justify-between gap-3 py-4">
                    <div className="min-w-0 flex-1 basis-64">
                      <h3 className="text-sm font-medium text-text-primary">{item.label}</h3>
                      <p className="mt-1 text-sm text-text-muted">{item.evidence}</p>
                      <p className="mt-1 text-xs text-text-muted">{item.section}</p>
                    </div>
                    <div className="ml-auto">
                      <PageAction
                        label={submittedCategories.has(item.category) ? 'Add evidence' : 'Submit evidence'}
                        onClick={() => setClaimCategory(item.category)}
                        disabled={withdraw.isPending || isRefreshing}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-sm text-text-muted">
                After adding evidence, request eligibility from the exact company and consent to sharing it. The company
                records its own decision; new actions recheck that decision and its scope.
              </p>
            </Section>
          </>
        )}
        <Section title="Supporting payslips">
          <DocumentsPanel />
        </Section>
      </Page>
      {withdrawing && (
        <Confirmation
          isOpen
          title="Withdraw this claim?"
          confirmLabel="Withdraw claim"
          busy={withdraw.isPending}
          busyLabel="Withdrawing…"
          onClose={() => setWithdrawing(null)}
          onConfirm={() => withdraw.mutate(withdrawing.uuid, { onSettled: () => setWithdrawing(null) })}
        >
          Your {withdrawing.categoryDisplay} claim is withdrawn and can&apos;t be shared again. Any company eligibility
          that relies on it ends. You can submit new evidence later.
        </Confirmation>
      )}
      <ClaimModal
        isOpen={claimCategory !== null}
        onClose={() => setClaimCategory(null)}
        category={claimCategory}
        submissionBlockedReason={submissionBlockedReason}
        onRetry={hasError ? () => void retry() : undefined}
        isRetrying={isRefreshing}
        onSuccess={() => {
          setClaimCategory(null);
          void refresh();
        }}
      />
    </>
  );
}

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { DESTINATIONS, deleteInvestorClassification, formatDate, getErrorMessage } from '@ledova/shared';
import type { InvestorCategory, InvestorClassification } from '@ledova/shared';
import { LinkRow, Row, Rows, Section, Status, type Tone } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { CATEGORIES, REASON_TEXT, WHOLESALE_ONLY_NOTICE } from './constants';
import { ClaimModal } from './ClaimModal';
import { useInvestorEligibility } from './useInvestorEligibility';

function claimState(classification: InvestorClassification): { label: string; tone: Tone } {
  if (classification.status === 'submitted') return { label: 'Available to share', tone: 'moving' };
  if (classification.status === 'verified')
    return {
      label: classification.isExpired ? 'Historical verification expired' : 'Historical verification',
      tone: 'closed',
    };
  return { label: classification.statusDisplay, tone: 'closed' };
}

export default function InvestorEligibilityPage() {
  const { eligibility, classifications, isLoading, hasError, isRefreshing, retry, refresh } = useInvestorEligibility();
  const [claimCategory, setClaimCategory] = useState<InvestorCategory | null>(null);

  const withdraw = useMutation({
    mutationFn: (uuid: string) => deleteInvestorClassification(apiClient, uuid),
    onSuccess: refresh,
  });

  const isReady = eligibility?.isReady ?? false;
  const submittedCategories = new Set(
    classifications.filter((claim) => claim.status === 'submitted').map((claim) => claim.category),
  );
  const submissionBlockedReason = hasError
    ? 'Your verification could not be loaded. Try again before continuing.'
    : isLoading || isRefreshing
      ? 'Refreshing your verification before continuing.'
      : null;

  return (
    <>
      <Page loading={isLoading}>
        {hasError ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-6">
            <p className="text-sm text-text-primary">
              Your verification could not be loaded. Try again before continuing.
            </p>
            <PageAction label="Try again" onClick={() => void retry()} disabled={isRefreshing} />
          </div>
        ) : (
          <>
            <Section title="Account readiness">
              <LinkRow to={DESTINATIONS.eligibilityRequests.path} label={DESTINATIONS.eligibilityRequests.title} />
              <p className="py-2 text-sm text-text-primary">
                <Status tone={isReady ? 'done' : 'waiting'}>
                  {isReady ? 'Account ready' : 'Account checks needed'}
                </Status>
              </p>
              {isReady ? (
                <LinkRow to={DESTINATIONS.directory.path} label={DESTINATIONS.directory.title} />
              ) : (
                <ul className="space-y-1 text-sm text-text-muted">
                  {(eligibility?.reasons ?? []).map((reason) => (
                    <li key={reason}>{REASON_TEXT[reason] ?? reason}</li>
                  ))}
                </ul>
              )}
              <p className="text-sm text-text-muted">
                Account readiness does not grant investment access. Each company decides eligibility for its own
                offerings and share classes.
              </p>
              <p className="text-sm text-text-muted">{WHOLESALE_ONLY_NOTICE}</p>
            </Section>

            <Section title="Your claims">
              {withdraw.isError && (
                <p role="alert" className="py-2 text-sm text-error-light">
                  {getErrorMessage(withdraw.error, 'Your claim could not be withdrawn. Try again.')}
                </p>
              )}
              {classifications.length === 0 ? (
                <p className="py-3 text-sm text-text-muted">
                  You have not submitted evidence yet. Choose a category below.
                </p>
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
                            <PageAction
                              label={
                                withdraw.isPending && withdraw.variables === claim.uuid
                                  ? 'Withdrawing…'
                                  : 'Withdraw claim'
                              }
                              onClick={() => withdraw.mutate(claim.uuid)}
                              disabled={withdraw.isPending}
                            />
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
                    <PageAction
                      label={submittedCategories.has(item.category) ? 'Add evidence' : 'Submit evidence'}
                      onClick={() => setClaimCategory(item.category)}
                      disabled={!eligibility?.account || withdraw.isPending || isRefreshing}
                    />
                  </div>
                ))}
              </div>
            </Section>

            <Section title="What happens next">
              <ol className="list-decimal space-y-2 py-2 pl-5 text-sm text-text-muted">
                <li>Choose the category that applies to you and attach the evidence.</li>
                <li>
                  Choose the exact company or known offering in Eligibility requests and consent to sharing your
                  evidence.
                </li>
                <li>The company records its decision. New investment actions recheck that decision and its scope.</li>
                <li>Your submitted sources and historical reviews remain separate from company decisions.</li>
              </ol>
            </Section>
          </>
        )}
      </Page>
      <ClaimModal
        isOpen={claimCategory !== null}
        onClose={() => setClaimCategory(null)}
        category={claimCategory}
        userAccount={eligibility?.account ?? null}
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

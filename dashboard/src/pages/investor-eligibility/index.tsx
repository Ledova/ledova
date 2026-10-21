import { useState } from 'react';
import { DESTINATIONS, formatDate, refusalSentences, failureSentence } from '@ledova/shared';
import type { InvestorCategory, InvestorClassification } from '@ledova/shared';
import { LinkRow, Row, Rows, Section, Status, type Tone, LoadError } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { Confirmation } from '@components/Modal';
import { useInvestorWithdrawal } from './useInvestorWithdrawal';
import { CATEGORIES, REASON_TEXT, WHOLESALE_ONLY_NOTICE } from './constants';
import { ClaimModal } from './ClaimModal';
import { useInvestorEligibility } from '@hooks/useInvestorEligibility';

const CLASSIFICATION_TONES = new Map<string, Tone>([['submitted', 'moving']]);
const READINESS_TONES = new Map<boolean, Tone>([
  [true, 'done'],
  [false, 'waiting'],
]);

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
  const { eligibility, classifications, isLoading, hasError, isRefreshing, retry, refresh } = useInvestorEligibility();
  const [claimCategory, setClaimCategory] = useState<InvestorCategory | null>(null);

  const withdraw = useInvestorWithdrawal(refresh);
  const [withdrawing, setWithdrawing] = useState<InvestorClassification | null>(null);

  const isReady = eligibility?.isReady ?? false;
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
      <Page narrow loading={isLoading}>
        {hasError ? (
          <LoadError retry={retry} busy={isRefreshing}>
            Your verification could not be loaded.
          </LoadError>
        ) : (
          <>
            <Section title="Account readiness">
              <LinkRow to={DESTINATIONS.eligibilityRequests.path} label={DESTINATIONS.eligibilityRequests.title} />
              <p className="py-2 text-sm text-text-primary">
                <Status tone={READINESS_TONES.get(!!isReady)!}>
                  {isReady ? 'Account ready' : 'Account checks needed'}
                </Status>
              </p>
              {isReady ? (
                <LinkRow to={DESTINATIONS.directory.path} label={DESTINATIONS.directory.title} />
              ) : (
                <ul className="space-y-1 text-sm text-text-muted">
                  {refusalSentences(eligibility?.reasons ?? [], REASON_TEXT).map((sentence) => (
                    <li key={sentence}>{sentence}</li>
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
                            <PageAction
                              label="Withdraw claim"
                              busy={withdraw.isPending && withdraw.variables === claim.uuid}
                              busyLabel="Withdrawing…"
                              onClick={() => setWithdrawing(claim)}
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
              <p className="text-sm text-text-muted">
                After adding evidence, request eligibility for the exact company or offering and consent to sharing it.
                The company records its own decision; new investment actions recheck that decision and its scope.
              </p>
              <LinkRow to={DESTINATIONS.eligibilityRequests.path} label="Request company eligibility" />
            </Section>
          </>
        )}
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

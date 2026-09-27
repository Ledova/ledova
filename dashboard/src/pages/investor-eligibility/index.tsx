import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { DESTINATIONS, deleteInvestorClassification, formatDate, getErrorMessage } from '@ledova/shared';
import type { InvestorCategory, InvestorClassification } from '@ledova/shared';
import { Row, Rows, Section, Status, type Tone } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import apiClient from '@services/apiClient';
import { CATEGORIES, REASON_TEXT, WHOLESALE_ONLY_NOTICE } from './constants';
import { ClaimModal } from './ClaimModal';
import { useInvestorEligibility } from './useInvestorEligibility';

function claimState(classification: InvestorClassification): { label: string; tone: Tone } {
  if (classification.isLive) return { label: 'Verified', tone: 'done' };
  if (classification.isExpired) return { label: 'Expired', tone: 'closed' };
  if (classification.status === 'submitted') return { label: 'Awaiting review', tone: 'moving' };
  return { label: classification.statusDisplay, tone: 'closed' };
}

export default function InvestorEligibilityPage() {
  const { eligibility, classifications, isLoading, hasError, isRefreshing, retry, refresh } = useInvestorEligibility();
  const [claimCategory, setClaimCategory] = useState<InvestorCategory | null>(null);

  const withdraw = useMutation({
    mutationFn: (uuid: string) => deleteInvestorClassification(apiClient, uuid),
    onSuccess: refresh,
  });

  if (isLoading) return <Page loading />;

  if (hasError) {
    return (
      <Page>
        <div role="alert" className="flex flex-col items-start gap-3 py-6">
          <p className="text-sm text-text-primary">
            Your verification could not be loaded. Try again before continuing.
          </p>
          <PageAction label="Try again" onClick={() => void retry()} disabled={isRefreshing} />
        </div>
      </Page>
    );
  }

  const isEligible = eligibility?.isEligible ?? false;
  const openClaim = classifications.find((claim) => claim.status === 'submitted');
  const liveCategories = new Set(classifications.filter((claim) => claim.isLive).map((claim) => claim.category));

  return (
    <Page>
      <p className="text-sm text-text-muted">Your investor status and the evidence reviewed by the operator.</p>
      <Section title="Investor status">
        <p className="py-2 text-sm text-text-primary">
          <Status tone={isEligible ? 'done' : 'waiting'}>
            {isEligible ? 'Verified to invest' : 'Verification needed'}
          </Status>
        </p>
        {isEligible ? (
          <Link
            to={DESTINATIONS.directory.path}
            className="w-fit text-sm text-brand-light underline underline-offset-4"
          >
            View the directory
          </Link>
        ) : (
          <ul className="space-y-1 text-sm text-text-muted">
            {(eligibility?.reasons ?? []).map((reason) => (
              <li key={reason}>{REASON_TEXT[reason] ?? reason}</li>
            ))}
          </ul>
        )}
        <p className="text-sm text-text-muted">{WHOLESALE_ONLY_NOTICE}</p>
      </Section>

      <Section title="Your claims">
        {withdraw.isError && (
          <p role="alert" className="py-2 text-sm text-error-light">
            {getErrorMessage(withdraw.error, 'Your claim could not be withdrawn. Try again.')}
          </p>
        )}
        {classifications.length === 0 ? (
          <p className="py-3 text-sm text-text-muted">You have not submitted evidence yet. Choose a category below.</p>
        ) : (
          <div className="divide-y divide-border-subtle">
            {classifications.map((claim) => {
              const state = claimState(claim);
              return (
                <article key={claim.uuid} className="min-w-0 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-48">
                      <h3 className="break-words text-sm font-medium text-text-primary">{claim.categoryDisplay}</h3>
                      <p className="mt-1 text-sm text-text-muted">
                        <Status tone={state.tone}>{state.label}</Status>
                      </p>
                    </div>
                    {claim.status === 'submitted' && (
                      <PageAction
                        label={
                          withdraw.isPending && withdraw.variables === claim.uuid ? 'Withdrawing…' : 'Withdraw claim'
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
                  {claim.rejectionReason && <p className="pt-2 text-sm text-text-muted">{claim.rejectionReason}</p>}
                </article>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="How you qualify">
        {openClaim && (
          <p className="text-sm text-text-muted">
            Your evidence is awaiting review. You can withdraw that claim before submitting another.
          </p>
        )}
        <div className="divide-y divide-border-subtle">
          {CATEGORIES.map((item) => (
            <div key={item.category} className="flex flex-wrap items-start justify-between gap-3 py-4">
              <div className="min-w-0 flex-1 basis-64">
                <h3 className="text-sm font-medium text-text-primary">{item.label}</h3>
                <p className="mt-1 text-sm text-text-muted">{item.evidence}</p>
                <p className="mt-1 text-xs text-text-muted">{item.section}</p>
              </div>
              <PageAction
                label={liveCategories.has(item.category) ? 'Update evidence' : 'Submit evidence'}
                onClick={() => setClaimCategory(item.category)}
                disabled={!!openClaim || !eligibility?.account || withdraw.isPending}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="What happens next">
        <ol className="list-decimal space-y-2 py-2 pl-5 text-sm text-text-muted">
          <li>Choose the category that applies to you and attach the evidence.</li>
          <li>The operator reviews your evidence and sets an expiry date.</li>
          <li>Once verified, you can view eligible offerings and apply for shares.</li>
          <li>Update your evidence before it expires to stay eligible.</li>
        </ol>
      </Section>

      <ClaimModal
        isOpen={claimCategory !== null}
        onClose={() => setClaimCategory(null)}
        category={claimCategory}
        userAccount={eligibility?.account ?? null}
        onSuccess={() => {
          setClaimCategory(null);
          void refresh();
        }}
      />
    </Page>
  );
}

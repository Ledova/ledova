import { formatDateTime, ELIGIBILITY_OUTCOME_LABELS } from '@ledova/shared';
import type { CompanyEligibilityRequest } from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { EligibilitySummary } from './EligibilitySummary';

export function EligibilityHistory({
  record,
  companyName,
}: {
  record: CompanyEligibilityRequest;
  companyName?: string;
}) {
  const decision = record.decision;
  const revocation = decision?.revocation;
  return (
    <Section title="Request and outcome">
      <Rows>
        <Row label="Outcome">{ELIGIBILITY_OUTCOME_LABELS[record.outcome]}</Row>
        <Row label="Submitted">{formatDateTime(record.submittedAt)}</Row>
        {decision && (
          <>
            <Row label="Decision">{ELIGIBILITY_OUTCOME_LABELS[decision.outcome]}</Row>
            <Row label="Decided on">{formatDateTime(decision.decidedAt)}</Row>
            {decision.outcome === 'accepted' && (
              <Row label="Acceptance expiry">{formatDateTime(decision.expiresAt, 'No acceptance expiry')}</Row>
            )}
            {decision.reason && <Row label="Refusal reason">{decision.reason}</Row>}
          </>
        )}
        {record.withdrawal && <Row label="Withdrawn on">{formatDateTime(record.withdrawal.withdrawnAt)}</Row>}
        {revocation && (
          <>
            <Row label="Revoked on">{formatDateTime(revocation.revokedAt)}</Row>
            <Row label="Revocation reason">{revocation.reason}</Row>
          </>
        )}
      </Rows>
      <EligibilitySummary summary={record.sharedSummary} companyName={companyName} />
      {record.outcome === 'accepted' && (
        <p className="text-sm text-text-muted">
          Acceptance remains subject to current requirements, evidence availability, expiry and revocation.
        </p>
      )}
    </Section>
  );
}

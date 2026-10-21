import { formatDateTime, ELIGIBILITY_OUTCOME_LABELS, shortReference } from '@ledova/shared';
import type { CompanyEligibilityRequest } from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { EligibilitySummary } from './EligibilitySummary';

export function EligibilityHistory({ record }: { record: CompanyEligibilityRequest }) {
  const decision = record.decision;
  const revocation = decision?.revocation;
  return (
    <Section title="Retained request and outcome">
      <Rows>
        <Row label="Request">{shortReference(record.uuid)}</Row>
        <Row label="Outcome">{ELIGIBILITY_OUTCOME_LABELS[record.outcome]}</Row>
        <Row label="Submitted">{formatDateTime(record.submittedAt)}</Row>
        <Row label="Request digest">{record.digest}</Row>
        <Row label="Request key">{shortReference(record.idempotencyKey)}</Row>
        {decision && (
          <>
            <Row label="Decision">{ELIGIBILITY_OUTCOME_LABELS[decision.outcome]}</Row>
            <Row label="Decision appointment">{shortReference(decision.appointment)}</Row>
            <Row label="Decision time">{formatDateTime(decision.decidedAt)}</Row>
            <Row label="Decision expiry">{formatDateTime(decision.expiresAt, 'No acceptance expiry')}</Row>
            <Row label="Decision key">{shortReference(decision.idempotencyKey)}</Row>
            <Row label="Decision digest">{decision.digest}</Row>
            {decision.reason && <Row label="Refusal reason">{decision.reason}</Row>}
          </>
        )}
        {record.withdrawal && (
          <>
            <Row label="Withdrawn">{formatDateTime(record.withdrawal.withdrawnAt)}</Row>
            <Row label="Withdrawal key">{shortReference(record.withdrawal.idempotencyKey)}</Row>
          </>
        )}
        {revocation && (
          <>
            <Row label="Revoked">{formatDateTime(revocation.revokedAt)}</Row>
            <Row label="Revocation appointment">{shortReference(revocation.appointment)}</Row>
            <Row label="Revocation reason">{revocation.reason}</Row>
            <Row label="Revocation key">{shortReference(revocation.idempotencyKey)}</Row>
          </>
        )}
      </Rows>
      <EligibilitySummary summary={record.sharedSummary} />
      {record.outcome === 'accepted' && (
        <p className="text-sm text-text-muted">
          Acceptance remains subject to current requirements, evidence availability, expiry and revocation.
        </p>
      )}
    </Section>
  );
}

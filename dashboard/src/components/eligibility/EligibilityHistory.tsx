import type { CompanyEligibilityRequest } from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { EligibilitySummary } from './EligibilitySummary';

export function EligibilityHistory({ record }: { record: CompanyEligibilityRequest }) {
  const decision = record.decision;
  const revocation = decision?.revocation;
  return (
    <Section title="Retained request and outcome">
      <Rows>
        <Row label="Request">{record.uuid}</Row>
        <Row label="Outcome">{record.outcome}</Row>
        <Row label="Submitted">{record.submittedAt}</Row>
        <Row label="Submitted by">{record.submittedBy}</Row>
        <Row label="Request digest">{record.digest}</Row>
        <Row label="Request key">{record.idempotencyKey}</Row>
        {decision && (
          <>
            <Row label="Decision">{decision.outcome}</Row>
            <Row label="Decision maker">{decision.decidedBy}</Row>
            <Row label="Decision appointment">{decision.appointment}</Row>
            <Row label="Decision time">{decision.decidedAt}</Row>
            <Row label="Decision expiry">{decision.expiresAt ?? 'No acceptance expiry'}</Row>
            <Row label="Decision key">{decision.idempotencyKey}</Row>
            <Row label="Decision digest">{decision.digest}</Row>
            {decision.reason && <Row label="Refusal reason">{decision.reason}</Row>}
          </>
        )}
        {record.withdrawal && (
          <>
            <Row label="Withdrawn">{record.withdrawal.withdrawnAt}</Row>
            <Row label="Withdrawn by">{record.withdrawal.withdrawnBy}</Row>
            <Row label="Withdrawal key">{record.withdrawal.idempotencyKey}</Row>
          </>
        )}
        {revocation && (
          <>
            <Row label="Revoked">{revocation.revokedAt}</Row>
            <Row label="Revoked by">{revocation.revokedBy}</Row>
            <Row label="Revocation appointment">{revocation.appointment}</Row>
            <Row label="Revocation reason">{revocation.reason}</Row>
            <Row label="Revocation key">{revocation.idempotencyKey}</Row>
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

import { Text, View } from 'react-native';
import { formatDateTime, type CompanyEligibilityRequest } from '@ledova/shared';
import { Row, Rows } from '../../components/Ledger';
import { useCompanyStyles } from '../company-register/styles';
import { EligibilitySummary } from './EligibilitySummary';

export function EligibilityRecord({ record }: { record: CompanyEligibilityRequest }) {
  const styles = useCompanyStyles();
  return (
    <View style={styles.group}>
      <Rows>
        <Row label="Request">{record.uuid}</Row>
        <Row label="Outcome">{record.outcome}</Row>
        <Row label="Submitted">{formatDateTime(record.submittedAt)}</Row>
      </Rows>
      <EligibilitySummary summary={record.sharedSummary} />
      <Text style={styles.heading}>Retained history</Text>
      <Rows>
        <Row label="Request digest">{record.digest}</Row>
        <Row label="Submitted by">{String(record.submittedBy)}</Row>
        {record.decision && (
          <>
            <Row label="Company decision">{record.decision.outcome}</Row>
            <Row label="Decided">{formatDateTime(record.decision.decidedAt)}</Row>
            <Row label="Decided by">{String(record.decision.decidedBy)}</Row>
            <Row label="Decision appointment">{record.decision.appointment}</Row>
            {record.decision.expiresAt && (
              <Row label="Acceptance expiry">{formatDateTime(record.decision.expiresAt)}</Row>
            )}
            {record.decision.reason && <Row label="Refusal reason">{record.decision.reason}</Row>}
            <Row label="Decision digest">{record.decision.digest}</Row>
          </>
        )}
        {record.withdrawal && (
          <>
            <Row label="Withdrawn">{formatDateTime(record.withdrawal.withdrawnAt)}</Row>
            <Row label="Withdrawn by">{String(record.withdrawal.withdrawnBy)}</Row>
          </>
        )}
        {record.decision?.revocation && (
          <>
            <Row label="Revoked">{formatDateTime(record.decision.revocation.revokedAt)}</Row>
            <Row label="Revoked by">{String(record.decision.revocation.revokedBy)}</Row>
            <Row label="Revocation appointment">{record.decision.revocation.appointment}</Row>
            <Row label="Revocation reason">{record.decision.revocation.reason}</Row>
          </>
        )}
      </Rows>
    </View>
  );
}

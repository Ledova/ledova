import { formatDateTime, type RegisterDecisionKind, type RegisterProposal } from '@ledova/shared';
import { Row } from '@components/Ledger';

export function DecisionTrail({
  proposal,
  labels,
}: {
  proposal: RegisterProposal;
  labels: Record<RegisterDecisionKind, string>;
}) {
  return (
    <>
      {[...proposal.decisions]
        .sort((left, right) => Date.parse(left.decidedAt) - Date.parse(right.decidedAt))
        .map((item) => (
          <Row key={item.uuid} label={labels[item.kind]}>
            {item.decidedByName || 'Not provided'} · {formatDateTime(item.decidedAt)}
            {item.reason && ` · ${item.reason}`}
          </Row>
        ))}
      {proposal.decisions.length === 0 && proposal.reviewedAt && (
        <Row label="Decided on">{formatDateTime(proposal.reviewedAt)}</Row>
      )}
      {proposal.status === 'rejected' && proposal.rejectionReason && (
        <Row label="Rejection reason">{proposal.rejectionReason}</Row>
      )}
    </>
  );
}

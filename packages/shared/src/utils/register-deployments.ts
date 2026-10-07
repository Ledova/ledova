import type {
  RegisterDeployment,
  RegisterDeploymentSnapshot,
  RegisterDeploymentPreparation,
  RegisterDeploymentDecisionPreview,
  RegisterDecideRequest,
} from '../types';

function validSnapshot(snapshot: RegisterDeploymentSnapshot) {
  if (!snapshot?.company?.uuid || !snapshot.token?.uuid || !/^\d+$/.test(snapshot.token.authorisedShares)) return false;
  const register = snapshot.register;
  if (!register) return false;
  if (!register.present)
    return (
      register.initialized === null &&
      register.uuid === null &&
      register.sequence === null &&
      register.headHash === null &&
      register.issuedSupply === null
    );
  return (
    typeof register.initialized === 'boolean' &&
    !!register.uuid &&
    Number.isInteger(register.sequence) &&
    register.sequence !== null &&
    register.sequence >= 0 &&
    typeof register.headHash === 'string' &&
    (register.initialized ? /^\d+$/.test(register.issuedSupply ?? '') : register.issuedSupply === null)
  );
}

export function isPreparedRegisterDeployment(
  proposal: RegisterDeployment,
  request: RegisterDeploymentPreparation,
  company: string,
) {
  return (
    proposal.uuid === request.operationId &&
    proposal.operationId === request.operationId &&
    proposal.preparingAppointment === request.appointment &&
    proposal.token === request.token &&
    proposal.company === company &&
    proposal.providedBy === 'company' &&
    validSnapshot(proposal.snapshot) &&
    proposal.snapshot.company.uuid === company &&
    proposal.snapshot.token.uuid === request.token &&
    /^[0-9a-f]{64}$/.test(proposal.intentDigest) &&
    (proposal.status !== 'applied' ||
      (!!proposal.deploymentId &&
        !!proposal.approvalDecision &&
        (!proposal.execution || proposal.execution.deployment === proposal.deploymentId)))
  );
}

export function isRegisterDeploymentDecisionReceipt(
  proposal: RegisterDeployment,
  uuid: string,
  request: RegisterDecideRequest,
  preview?: RegisterDeploymentDecisionPreview,
) {
  const decision = proposal.decisions?.find((row) => row.idempotencyKey === request.idempotencyKey);
  if (
    proposal.uuid !== uuid ||
    proposal.operationId !== uuid ||
    !decision ||
    decision.kind !== request.kind ||
    decision.appointment !== request.appointment ||
    decision.digest !== request.previewDigest ||
    decision.reason !== (request.reason ?? '') ||
    !validSnapshot(proposal.snapshot) ||
    proposal.snapshot.company.uuid !== proposal.company ||
    proposal.snapshot.token.uuid !== proposal.token ||
    !/^[0-9a-f]{64}$/.test(proposal.intentDigest)
  )
    return false;
  if (
    preview &&
    (proposal.intentDigest !== preview.intentDigest ||
      JSON.stringify(proposal.snapshot) !== JSON.stringify(preview.snapshot))
  )
    return false;
  if (request.kind === 'apply')
    return (
      proposal.status === 'applied' &&
      proposal.reviewedAt === decision.decidedAt &&
      !!proposal.deploymentId &&
      !!proposal.approvalDecision &&
      (!preview?.approvalDecision || proposal.approvalDecision === preview.approvalDecision) &&
      (!proposal.execution || proposal.execution.deployment === proposal.deploymentId)
    );
  if (request.kind === 'reject')
    return (
      proposal.status === 'rejected' &&
      proposal.reviewedAt === decision.decidedAt &&
      proposal.rejectionReason === decision.reason
    );
  return ['submitted', 'applied', 'rejected'].includes(proposal.status);
}

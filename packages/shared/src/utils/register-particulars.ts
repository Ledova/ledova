import type { RegisterParticularsChange, RegisterParticularsChangePreparation } from '../types';

export function isPreparedRegisterParticularsChange(
  change: RegisterParticularsChange,
  request: RegisterParticularsChangePreparation,
) {
  return (
    change.uuid === request.operationId &&
    change.preparingAppointment === request.appointment &&
    change.member === request.member &&
    change.supportingEvidence === request.supportingEvidence &&
    change.name === request.name &&
    change.residentialAddress === request.residentialAddress &&
    change.asAt === request.asAt &&
    change.reason === request.reason &&
    change.providedBy === 'company'
  );
}

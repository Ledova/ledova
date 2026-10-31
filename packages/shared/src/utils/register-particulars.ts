import type { RegisterParticularsChange, RegisterParticularsEdit } from '../types';

export function isRegisterParticularsEditReceipt(change: RegisterParticularsChange, request: RegisterParticularsEdit) {
  return (
    change.uuid === request.operationId &&
    change.preparingAppointment === request.appointment &&
    change.member === request.member &&
    change.name === request.name &&
    change.residentialAddress === request.residentialAddress &&
    change.reason === (request.reason ?? '') &&
    (change.previousParticulars?.name ?? '') === request.expected.name &&
    (change.previousParticulars?.residentialAddress ?? '') === request.expected.residentialAddress &&
    change.status === 'applied' &&
    change.providedBy === 'company'
  );
}

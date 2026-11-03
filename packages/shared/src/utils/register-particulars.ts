import type { RegisterParticularsChange, RegisterParticularsEdit, TokenHoldersResponse } from '../types';

export function registerMembers(registers: TokenHoldersResponse[]) {
  const members = new Map<string, string | null>();
  for (const { member, name } of registers.flatMap((register) => register.holders))
    if (!members.get(member)) members.set(member, name);
  return members;
}

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

import type { RegisterParticularsChange, RegisterParticularsEdit, TokenHoldersResponse } from '../types';

export function registerMembers(registers: TokenHoldersResponse[]) {
  const members = new Map<string, string | null>();
  for (const { member, name } of registers.flatMap((register) => register.holders))
    if (!members.get(member)) members.set(member, name);
  return members;
}

export function particularsChanged(
  change: Pick<RegisterParticularsChange, 'name' | 'residentialAddress' | 'previousParticulars'>,
) {
  const before = change.previousParticulars;
  const name = !!before && before.name !== change.name;
  const address = !!before && before.residentialAddress !== change.residentialAddress;
  if (name && address) return 'Name and address changed';
  if (name) return 'Name changed';
  return address ? 'Address changed' : 'Particulars recorded';
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

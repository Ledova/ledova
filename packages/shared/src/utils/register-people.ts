import type { RegisterPersonRegistrationRecord, RegisterPersonRegistrationRequest } from '../types';

export function isRegisterPersonRegistrationReceipt(
  value: unknown,
  request: RegisterPersonRegistrationRequest,
): value is RegisterPersonRegistrationRecord {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<RegisterPersonRegistrationRecord>;
  return (
    row.uuid === request.operationId &&
    row.company === request.company &&
    row.member === request.member &&
    row.name === request.name &&
    row.residentialAddress === request.residentialAddress &&
    row.preparingAppointment === request.appointment &&
    typeof row.createdAt === 'string' &&
    Number.isFinite(Date.parse(row.createdAt))
  );
}

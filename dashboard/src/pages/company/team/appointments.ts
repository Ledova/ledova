import {
  COMPANY_AUTHORITY_CAPABILITIES,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  type CompanyCapability,
  type CompanyTeamAppointment,
  type OwnCompanyAppointment,
} from '@ledova/shared';

export function currentAppointment(appointment: OwnCompanyAppointment | CompanyTeamAppointment) {
  return (
    appointment.status === 'active' &&
    appointment.isEffective &&
    (!appointment.expiresAt || Date.parse(appointment.expiresAt) > Date.now())
  );
}

export function scopeLabels(values: CompanyCapability[]) {
  return (
    COMPANY_AUTHORITY_CAPABILITIES.filter(({ value }) => values.includes(value))
      .map(({ label }) => label)
      .join(', ') || 'None'
  );
}

export function sameScope(left: CompanyCapability[], right: CompanyCapability[]) {
  return Array.isArray(left) && Array.isArray(right) && [...left].sort().join('/') === [...right].sort().join('/');
}

export function appointmentReceipt(data: OwnCompanyAppointment) {
  return (
    typeof data?.uuid === 'string' &&
    !!data.uuid &&
    typeof data.company === 'string' &&
    !!data.company &&
    typeof data.companyName === 'string' &&
    ['initial', 'invitation', 'legacy_owner'].includes(data.source) &&
    ['active', 'expired', 'revoked'].includes(data.status) &&
    typeof data.isEffective === 'boolean' &&
    [data.capabilities, data.delegatableCapabilities].every(
      (values) =>
        Array.isArray(values) &&
        new Set(values).size === values.length &&
        values.every((value) => COMPANY_AUTHORITY_CAPABILITIES.some((capability) => capability.value === value)),
    ) &&
    (data.source === 'legacy_owner'
      ? data.declarationVersion === null && data.declarationText === null
      : data.declarationVersion === COMPANY_AUTHORITY_DECLARATION_VERSION &&
        data.declarationText === COMPANY_AUTHORITY_DECLARATION) &&
    Number.isFinite(Date.parse(data.createdAt)) &&
    (data.expiresAt === null || Number.isFinite(Date.parse(data.expiresAt))) &&
    (data.revokedAt === null || Number.isFinite(Date.parse(data.revokedAt))) &&
    (data.status === 'revoked' ? !!data.revokedAt && !data.isEffective : data.revokedAt === null)
  );
}

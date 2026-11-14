import {
  COMPANY_AUTHORITY_CAPABILITIES,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  COMPANY_SIGNUP_DECLARATION,
  COMPANY_SIGNUP_DECLARATION_VERSION,
} from '../constants/business/company-authority';
import { APPOINTMENT_SOURCE_LABELS, APPOINTMENT_STATUS_LABELS } from '../constants/business/labels';
import type { CompanyCapability, CompanyTeamAppointment, OwnCompanyAppointment } from '../types';
import { formatDateTime, formatShortDate } from './date';
import { appointmentForRegisterStep } from './register-commands';

export function currentAppointment(appointment: OwnCompanyAppointment | CompanyTeamAppointment) {
  return (
    appointment.status === 'active' &&
    appointment.isEffective &&
    (!appointment.expiresAt || Date.parse(appointment.expiresAt) > Date.now())
  );
}

export function hasCurrentAdminAppointment(appointments: OwnCompanyAppointment[]) {
  return appointments.some(
    (appointment) =>
      appointment.capabilities.includes('admin') &&
      !appointment.revokedAt &&
      !!appointmentForRegisterStep([appointment], appointment.company, 'prepare'),
  );
}

function invitationOpen(invitation: { acceptedAt: string | null; acceptanceDeadline: string }) {
  return !invitation.acceptedAt && Date.parse(invitation.acceptanceDeadline) > Date.now();
}

export function scopeLabels(values: CompanyCapability[]) {
  return (
    COMPANY_AUTHORITY_CAPABILITIES.filter(({ value }) => values.includes(value))
      .map(({ label }) => label)
      .join(', ') || 'None'
  );
}

export function requestScopeLabels(values: CompanyCapability[]) {
  return (
    values
      .map((value) => COMPANY_AUTHORITY_CAPABILITIES.find((item) => item.value === value)?.label ?? value)
      .join(', ') || 'None'
  );
}

export function sameScope(left: CompanyCapability[], right: CompanyCapability[]) {
  return Array.isArray(left) && Array.isArray(right) && [...left].sort().join('/') === [...right].sort().join('/');
}

const allActions = (values: CompanyCapability[]) =>
  COMPANY_AUTHORITY_CAPABILITIES.every(({ value }) => values.includes(value));

export function scopeFacts(capabilities: CompanyCapability[], delegatable: CompanyCapability[]) {
  const scope = allActions(capabilities) ? 'All actions' : scopeLabels(capabilities);
  if (!delegatable.length) return scope;
  if (sameScope(capabilities, delegatable)) return `${scope} · may delegate all of these`;
  return allActions(delegatable)
    ? `${scope} · may delegate all actions`
    : `${scope} · may delegate: ${scopeLabels(delegatable)}`;
}

export function appointmentStatus(appointment: OwnCompanyAppointment | CompanyTeamAppointment) {
  if (appointment.revokedAt) return APPOINTMENT_STATUS_LABELS.revoked;
  const label = APPOINTMENT_STATUS_LABELS[appointment.status];
  return appointment.status === 'active' && !currentAppointment(appointment) ? `${label} · not current` : label;
}

export function appointmentDates(appointment: OwnCompanyAppointment | CompanyTeamAppointment) {
  return [
    `${APPOINTMENT_SOURCE_LABELS[appointment.source]} ${formatShortDate(appointment.createdAt)}`,
    ...(appointment.revokedAt ? [`revoked ${formatShortDate(appointment.revokedAt)}`] : []),
    appointment.expiresAt
      ? `${appointment.status === 'active' ? 'expires' : 'expiry'} ${formatDateTime(appointment.expiresAt)}`
      : 'no expiry',
  ].join(' · ');
}

export function issuedInvitationDates(invitation: {
  acceptedAt: string | null;
  acceptanceDeadline: string;
  appointmentExpiresAt: string | null;
}) {
  return [
    invitation.acceptedAt
      ? `Accepted ${formatShortDate(invitation.acceptedAt)}`
      : `Not accepted · ${invitationOpen(invitation) ? 'accept before' : 'deadline passed'} ${formatDateTime(invitation.acceptanceDeadline)}`,
    invitation.appointmentExpiresAt
      ? `appointment expires ${formatDateTime(invitation.appointmentExpiresAt)}`
      : 'no appointment expiry',
  ].join(' · ');
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
      : (data.declarationVersion === COMPANY_AUTHORITY_DECLARATION_VERSION &&
          data.declarationText === COMPANY_AUTHORITY_DECLARATION) ||
        (data.source === 'initial' &&
          data.declarationVersion === COMPANY_SIGNUP_DECLARATION_VERSION &&
          data.declarationText === COMPANY_SIGNUP_DECLARATION)) &&
    Number.isFinite(Date.parse(data.createdAt)) &&
    (data.expiresAt === null || Number.isFinite(Date.parse(data.expiresAt))) &&
    (data.revokedAt === null || Number.isFinite(Date.parse(data.revokedAt))) &&
    (data.status === 'revoked' ? !!data.revokedAt && !data.isEffective : data.revokedAt === null)
  );
}

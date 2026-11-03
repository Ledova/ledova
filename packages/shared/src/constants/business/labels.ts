import type { MemberInvitation, OwnCompanyAppointment } from '../../types';

export const MEMBER_INVITATION_STATUS_LABELS: Record<MemberInvitation['status'], string> = {
  pending: 'Pending',
  expired: 'Expired',
  unavailable: 'No longer available',
  accepted: 'Accepted',
  revoked: 'Revoked',
};

export const APPOINTMENT_STATUS_LABELS: Record<OwnCompanyAppointment['status'], string> = {
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
};

export const APPOINTMENT_SOURCE_LABELS: Record<OwnCompanyAppointment['source'], string> = {
  initial: 'Initial self-declaration',
  invitation: 'Company invitation',
  legacy_owner: 'Legacy company owner',
};

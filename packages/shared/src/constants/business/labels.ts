import type { CompanyEligibilityRequest, MemberInvitation, OwnCompanyAppointment } from '../../types';

export const ELIGIBILITY_OUTCOME_LABELS: Record<CompanyEligibilityRequest['outcome'], string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  refused: 'Refused',
  withdrawn: 'Withdrawn',
  revoked: 'Revoked',
  expired: 'Expired',
};

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

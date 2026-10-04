import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type CompanyAuthorityRequest = ApiSchema<'CompanyAuthorityRequest'>;

export type CompanyAuthorityAdmission = ApiRequest<'api_v1_company_authority_requests_admit_create'>;

export type CompanyCapability = ApiSchema<'CompanyCapabilityEnum'>;

export type CompanyAuthoritySubmission = ApiRequest<'api_v1_company_authority_requests_create'> &
  Required<
    Pick<ApiRequest<'api_v1_company_authority_requests_create'>, 'requestedCapabilities' | 'delegatableCapabilities'>
  >;

export type CompanyAuthorityQueryParams = ApiQuery<'api_v1_company_authority_requests_list'>;

export type CompanyTeamInvitation = ApiSchema<'CompanyTeamInvitation'>;
export type CompanyTeamInvitationIssued = ApiSchema<'CompanyTeamInvitationIssued'>;
export type OwnCompanyAppointment = ApiSchema<'OwnCompanyAppointment'>;
export type CompanyTeamAppointment = ApiSchema<'CompanyTeamAppointment'>;
export type CreateCompanyTeamInvitationRequest = ApiRequest<'api_v1_company_authority_invitations_create'>;
export type AcceptCompanyTeamInvitationRequest = ApiRequest<'api_v1_company_authority_invitations_accept_create'>;
export type CompanyTeamInvitationQueryParams = ApiQuery<'api_v1_company_authority_invitations_list'>;
export type OwnCompanyAppointmentQueryParams = ApiQuery<'api_v1_company_authority_appointments_list'>;
export type CompanyTeamQueryParams = ApiQuery<'api_v1_company_authority_appointments_team_list'>;

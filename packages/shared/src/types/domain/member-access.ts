import type { ApiRequest, ApiSchema } from '../contracts';

export type MemberAssociation = ApiSchema<'MemberAssociation'>;
export type MemberInvitation = ApiSchema<'MemberInvitation'>;
export type MemberInvitationEmailed = ApiSchema<'MemberInvitationEmail'>;
export type MemberInvitationPreview = ApiSchema<'MemberInvitationPreview'>;
export type OwnMemberRecord = ApiSchema<'MemberRecord'>;
export type OwnMemberEntry = ApiSchema<'MemberRecordEntry'>;
export type OwnMemberEntries = ApiSchema<'MemberRecordEntries'>;
export type MemberParticularsRequest = ApiSchema<'MemberParticularsRequest'>;
export type MemberCertificateRequest = ApiSchema<'MemberCertificateRequest'>;
export type MemberCertificateFulfilmentPreview = ApiSchema<'MemberCertificateFulfilmentPreview'>;
export type MemberCertificateFulfilmentCreate = ApiRequest<'api_v1_tokens_member_certificate_requests_fulfil_create'>;

export type MemberInvitationCreate = ApiRequest<'api_v1_tokens_member_invitations_create'>;
export type MemberInvitationAccept = ApiRequest<'api_v1_tokens_member_invitations_accept_create'>;
export type MemberAssociationRevoke = ApiRequest<'api_v1_tokens_member_associations_revoke_create'>;
export type MemberParticularsRequestCreate = ApiRequest<'api_v1_tokens_member_particulars_requests_create'>;
export type MemberParticularsRequestPrepare = ApiRequest<'api_v1_tokens_member_particulars_requests_prepare_create'>;
export type MemberCertificateRequestCreate = ApiRequest<'api_v1_tokens_member_certificate_requests_create'>;
export type MemberCertificateRequestWithdraw = ApiRequest<'api_v1_tokens_member_certificate_requests_withdraw_create'>;

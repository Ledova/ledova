import type { ApiRequest, ApiSchema } from '../contracts';

export type MemberAssociation = ApiSchema<'MemberAssociation'>;
export type MemberInvitation = ApiSchema<'MemberInvitation'>;
export type MemberInvitationEmailed = ApiSchema<'MemberInvitationEmail'>;
export type MemberInvitationPreview = ApiSchema<'MemberInvitationPreview'>;
export type OwnMemberRecord = ApiSchema<'MemberRecord'>;
export type OwnMemberEntry = ApiSchema<'MemberRecordEntry'>;
export type OwnMemberEntries = ApiSchema<'MemberRecordEntries'>;

export type MemberInvitationCreate = ApiRequest<'api_v1_tokens_member_invitations_create'>;
export type MemberInvitationAccept = ApiRequest<'api_v1_tokens_member_invitations_accept_create'>;
export type MemberAssociationRevoke = ApiRequest<'api_v1_tokens_member_associations_revoke_create'>;

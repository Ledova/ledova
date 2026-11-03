import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS as URLS } from '../constants/api';
import { REGISTER_AWARD_COPY } from '../constants/business/register-awards';
import { createUserFriendlyError } from '../utils/errors';
import { hasValidOwnMemberAward } from '../utils/register-awards';
import type {
  MemberAssociation,
  MemberAssociationRevoke,
  MemberInvitation,
  MemberInvitationAccept,
  MemberInvitationCreate,
  MemberInvitationEmailed,
  MemberInvitationPreview,
  OwnMemberEntries,
  OwnMemberRecord,
  PaginatedResponse,
} from '../types';

function validOwnAwards(record: OwnMemberRecord) {
  return !!record && Array.isArray(record.awards) && record.awards.every(hasValidOwnMemberAward);
}

export const getOwnMemberRecords = async (api: AxiosInstance, page = 1, config: AxiosRequestConfig = {}) => {
  const response = await api.get<PaginatedResponse<OwnMemberRecord>>(URLS.MEMBER_RECORDS, {
    ...config,
    params: { page },
  });
  if (!response.data || !Array.isArray(response.data.results) || !response.data.results.every(validOwnAwards))
    throw createUserFriendlyError(REGISTER_AWARD_COPY.MEMBER_RECORDS_FAILED);
  return response;
};
export const getOwnMemberRecord = async (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) => {
  const response = await api.get<OwnMemberRecord>(URLS.MEMBER_RECORD(uuid), config);
  if (!validOwnAwards(response.data)) throw createUserFriendlyError(REGISTER_AWARD_COPY.MEMBER_RECORDS_FAILED);
  return response;
};
export const getOwnMemberEntries = (api: AxiosInstance, uuid: string, token: string, config: AxiosRequestConfig = {}) =>
  api.get<OwnMemberEntries>(URLS.MEMBER_ENTRIES(uuid), { ...config, params: { token } });
export const sendMemberInvitationEmail = (
  api: AxiosInstance,
  data: MemberInvitationCreate,
  config: AxiosRequestConfig = {},
) => api.post<MemberInvitationEmailed>(URLS.MEMBER_INVITATION_SEND_EMAIL, data, config);
export const previewMemberInvitation = (api: AxiosInstance, code: string, config: AxiosRequestConfig = {}) =>
  api.post<MemberInvitationPreview>(URLS.MEMBER_INVITATION_PREVIEW, { code }, config);
export const getMemberInvitations = (api: AxiosInstance, company: string, page = 1, config: AxiosRequestConfig = {}) =>
  api.get<PaginatedResponse<MemberInvitation>>(URLS.MEMBER_INVITATIONS, { ...config, params: { company, page } });
export const acceptMemberInvitation = (
  api: AxiosInstance,
  data: MemberInvitationAccept,
  config: AxiosRequestConfig = {},
) => api.post<MemberAssociation>(URLS.MEMBER_INVITATION_ACCEPT, data, config);
export const getMemberAssociations = (api: AxiosInstance, company: string, page = 1, config: AxiosRequestConfig = {}) =>
  api.get<PaginatedResponse<MemberAssociation>>(URLS.MEMBER_ASSOCIATIONS, { ...config, params: { company, page } });
export const revokeMemberAssociation = (
  api: AxiosInstance,
  uuid: string,
  data: MemberAssociationRevoke,
  config: AxiosRequestConfig = {},
) => api.post<MemberAssociation>(URLS.MEMBER_ASSOCIATION_REVOKE(uuid), data, config);

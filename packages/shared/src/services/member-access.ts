import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS as URLS } from '../constants/api';
import { REGISTER_AWARD_COPY } from '../constants/business/register-awards';
import { createUserFriendlyError } from '../utils/errors';
import { hasValidOwnMemberAward } from '../utils/register-awards';
import type {
  MemberAssociation,
  MemberAssociationRevoke,
  MemberCertificateRequest,
  MemberCertificateFulfilmentPreview,
  MemberCertificateFulfilmentCreate,
  MemberCertificateRequestCreate,
  MemberCertificateRequestWithdraw,
  MemberInvitation,
  MemberInvitationAccept,
  MemberInvitationCreate,
  MemberInvitationIssued,
  MemberInvitationEmailed,
  MemberInvitationPreview,
  MemberParticularsRequest,
  MemberParticularsRequestCreate,
  MemberParticularsRequestPrepare,
  OwnMemberEntries,
  OwnMemberRecord,
  PaginatedResponse,
  RegisterParticularsChange,
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
export const createMemberInvitation = (
  api: AxiosInstance,
  data: MemberInvitationCreate,
  config: AxiosRequestConfig = {},
) => api.post<MemberInvitationIssued>(URLS.MEMBER_INVITATIONS, data, config);
export const sendMemberInvitationEmail = (
  api: AxiosInstance,
  data: MemberInvitationCreate,
  config: AxiosRequestConfig = {},
) => api.post<MemberInvitationEmailed>(URLS.MEMBER_INVITATION_SEND_EMAIL, data, config);
export const previewMemberInvitation = (api: AxiosInstance, code: string, config: AxiosRequestConfig = {}) =>
  api.post<MemberInvitationPreview>(URLS.MEMBER_INVITATION_PREVIEW, { code }, config);
export const getMemberInvitation = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<MemberInvitation>(URLS.MEMBER_INVITATION(uuid), config);
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
export const getMemberParticularsRequests = (
  api: AxiosInstance,
  params: { association?: string; company?: string; page: number },
  config: AxiosRequestConfig = {},
) => api.get<PaginatedResponse<MemberParticularsRequest>>(URLS.MEMBER_PARTICULARS_REQUESTS, { ...config, params });
export const createMemberParticularsRequest = (
  api: AxiosInstance,
  data: MemberParticularsRequestCreate,
  config: AxiosRequestConfig = {},
) => api.post<MemberParticularsRequest>(URLS.MEMBER_PARTICULARS_REQUESTS, data, config);
export const prepareMemberParticularsRequest = (
  api: AxiosInstance,
  uuid: string,
  data: MemberParticularsRequestPrepare,
  config: AxiosRequestConfig = {},
) => api.post<RegisterParticularsChange>(URLS.MEMBER_PARTICULARS_REQUEST_PREPARE(uuid), data, config);
export const getMemberCertificateRequests = (
  api: AxiosInstance,
  params: { association?: string; company?: string; page: number },
  config: AxiosRequestConfig = {},
) => api.get<PaginatedResponse<MemberCertificateRequest>>(URLS.MEMBER_CERTIFICATE_REQUESTS, { ...config, params });
export const createMemberCertificateRequest = (
  api: AxiosInstance,
  data: MemberCertificateRequestCreate,
  config: AxiosRequestConfig = {},
) => api.post<MemberCertificateRequest>(URLS.MEMBER_CERTIFICATE_REQUESTS, data, config);
export const withdrawMemberCertificateRequest = (
  api: AxiosInstance,
  uuid: string,
  data: MemberCertificateRequestWithdraw,
  config: AxiosRequestConfig = {},
) => api.post<MemberCertificateRequest>(URLS.MEMBER_CERTIFICATE_REQUEST_WITHDRAW(uuid), data, config);

export const getMemberCertificateFulfilmentPreview = (
  api: AxiosInstance,
  uuid: string,
  config: AxiosRequestConfig = {},
) => api.get<MemberCertificateFulfilmentPreview>(URLS.MEMBER_CERTIFICATE_PREVIEW(uuid), config);
export const fulfilMemberCertificateRequest = (
  api: AxiosInstance,
  uuid: string,
  data: MemberCertificateFulfilmentCreate,
  config: AxiosRequestConfig = {},
) => api.post<MemberCertificateRequest>(URLS.MEMBER_CERTIFICATE_FULFIL(uuid), data, config);
export const getMemberCertificateFile = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<Blob>(URLS.MEMBER_CERTIFICATE_FILE(uuid), { ...config, responseType: 'blob' });
export const getMemberCertificateFileBytes = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<ArrayBuffer>(URLS.MEMBER_CERTIFICATE_FILE(uuid), { ...config, responseType: 'arraybuffer' });

import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS as URLS } from '../constants/api';
import type {
  MemberAssociation,
  MemberAssociationRevoke,
  MemberCertificateRequest,
  MemberCertificateRequestCreate,
  MemberCertificateRequestWithdraw,
  MemberInvitation,
  MemberInvitationAccept,
  MemberInvitationCreate,
  MemberInvitationIssued,
  MemberParticularsRequest,
  MemberParticularsRequestCreate,
  MemberParticularsRequestPrepare,
  OwnMemberEntries,
  OwnMemberRecord,
  PaginatedResponse,
  RegisterParticularsChange,
} from '../types';

export const getOwnMemberRecords = (api: AxiosInstance, page = 1, config: AxiosRequestConfig = {}) =>
  api.get<PaginatedResponse<OwnMemberRecord>>(URLS.MEMBER_RECORDS, { ...config, params: { page } });
export const getOwnMemberRecord = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<OwnMemberRecord>(URLS.MEMBER_RECORD(uuid), config);
export const getOwnMemberEntries = (api: AxiosInstance, uuid: string, token: string, config: AxiosRequestConfig = {}) =>
  api.get<OwnMemberEntries>(URLS.MEMBER_ENTRIES(uuid), { ...config, params: { token } });
export const createMemberInvitation = (
  api: AxiosInstance,
  data: MemberInvitationCreate,
  config: AxiosRequestConfig = {},
) => api.post<MemberInvitationIssued>(URLS.MEMBER_INVITATIONS, data, config);
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

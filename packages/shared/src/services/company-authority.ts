import { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import { COMPANY_AUTHORITY_DECLARATION_VERSION } from '../constants/business/company-authority';
import type {
  AcceptCompanyTeamInvitationRequest,
  CompanyAuthorityAdmission,
  CompanyAuthorityQueryParams,
  CompanyAuthorityRequest,
  CompanyAuthoritySubmission,
  CompanyTeamAppointment,
  CompanyTeamInvitation,
  CompanyTeamInvitationIssued,
  CompanyTeamInvitationQueryParams,
  CompanyTeamQueryParams,
  CreateCompanyTeamInvitationRequest,
  OwnCompanyAppointment,
  OwnCompanyAppointmentQueryParams,
  PaginatedResponse,
} from '../types';

const REQUESTS = '/api/v1/company-authority/requests/';
const INVITATIONS = '/api/v1/company-authority/invitations/';
const APPOINTMENTS = '/api/v1/company-authority/appointments/';

export const getCompanyAuthorityRequests = (
  apiClient: AxiosInstance,
  company?: string,
  page = 1,
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<PaginatedResponse<CompanyAuthorityRequest>>(REQUESTS, {
    ...config,
    params: { page, ...(company ? { company } : {}) } satisfies CompanyAuthorityQueryParams,
  });

export const submitCompanyAuthorityRequest = (
  apiClient: AxiosInstance,
  data: CompanyAuthoritySubmission,
  config?: AxiosRequestConfig,
) => {
  const form = new FormData();
  form.append('company', data.company);
  form.append('idempotency_key', data.idempotencyKey);
  form.append('file', data.file);
  data.requestedCapabilities.forEach((capability) => form.append('requested_capabilities', capability));
  data.delegatableCapabilities.forEach((capability) => form.append('delegatable_capabilities', capability));
  if (data.requestedExpiresAt) form.append('requested_expires_at', data.requestedExpiresAt);
  return apiClient.post<CompanyAuthorityRequest>(REQUESTS, form, {
    ...config,
    headers: { ...config?.headers, 'Content-Type': 'multipart/form-data' },
  });
};

export const downloadCompanyAuthorityFile = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<ArrayBuffer>(`${REQUESTS}${uuid}/file/`, { ...config, responseType: 'arraybuffer' });

export const withdrawCompanyAuthorityRequest = (
  apiClient: AxiosInstance,
  uuid: string,
  config: AxiosRequestConfig = {},
) => apiClient.post<CompanyAuthorityRequest>(`${REQUESTS}${uuid}/withdraw/`, {}, config);

export const admitCompanyAuthorityRequest = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.post<CompanyAuthorityRequest>(
    `${REQUESTS}${uuid}/admit/`,
    {
      declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION,
      acceptDeclaration: true,
    } satisfies CompanyAuthorityAdmission,
    config,
  );

export const revokeCompanyAuthorityAppointment = (
  apiClient: AxiosInstance,
  uuid: string,
  config: AxiosRequestConfig = {},
) => apiClient.post<CompanyAuthorityRequest>(`${REQUESTS}${uuid}/revoke/`, {}, config);

export const getCompanyTeamInvitations = (apiClient: AxiosInstance, page = 1, config: AxiosRequestConfig = {}) =>
  apiClient.get<PaginatedResponse<CompanyTeamInvitation>>(INVITATIONS, {
    ...config,
    params: { page } satisfies CompanyTeamInvitationQueryParams,
  });

export const createCompanyTeamInvitation = (
  apiClient: AxiosInstance,
  data: CreateCompanyTeamInvitationRequest,
  config: AxiosRequestConfig = {},
) => apiClient.post<CompanyTeamInvitationIssued>(INVITATIONS, data, config);

export const acceptCompanyTeamInvitation = (apiClient: AxiosInstance, code: string, config: AxiosRequestConfig = {}) =>
  apiClient.post<OwnCompanyAppointment>(
    `${INVITATIONS}accept/`,
    {
      code,
      declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION,
      acceptDeclaration: true,
    } satisfies AcceptCompanyTeamInvitationRequest,
    config,
  );

export const getOwnCompanyAppointments = (apiClient: AxiosInstance, page = 1, config: AxiosRequestConfig = {}) =>
  apiClient.get<PaginatedResponse<OwnCompanyAppointment>>(APPOINTMENTS, {
    ...config,
    params: { page } satisfies OwnCompanyAppointmentQueryParams,
  });

export const getCompanyTeam = (apiClient: AxiosInstance, company: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<CompanyTeamAppointment[]>(`${APPOINTMENTS}team/`, {
    ...config,
    params: { company } satisfies CompanyTeamQueryParams,
  });

export const revokeCompanyAppointment = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.post<OwnCompanyAppointment>(`${APPOINTMENTS}${uuid}/revoke/`, {}, config);

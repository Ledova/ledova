import { type AxiosInstance, type AxiosRequestConfig } from 'axios';
import type {
  CompanyAuthorityQueryParams,
  CompanyAuthorityRequest,
  CompanyAuthoritySubmission,
  PaginatedResponse,
} from '../types';

const REQUESTS = '/api/v1/company-authority/requests/';

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

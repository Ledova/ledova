import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterGrant,
  RegisterGrantDecideRequest,
  RegisterGrantDecisionPreview,
  RegisterGrantDecisionRequest,
  RegisterGrantPreparation,
  RegisterGrantQueryParams,
} from '../types';

export const getRegisterGrants = (
  apiClient: AxiosInstance,
  params: RegisterGrantQueryParams = {},
  config: AxiosRequestConfig = {},
) => apiClient.get<PaginatedResponse<RegisterGrant>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANTS, { ...config, params });

export const prepareRegisterGrant = (
  apiClient: AxiosInstance,
  data: RegisterGrantPreparation,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterGrant>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANTS, data, config);

export const previewRegisterGrantDecision = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterGrantDecisionRequest,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterGrantDecisionPreview>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_PREVIEW(uuid), data, config);

export const decideRegisterGrant = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterGrantDecideRequest,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterGrant>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_DECIDE(uuid), data, config);

export const downloadRegisterGrantFile = (
  apiClient: AxiosInstance,
  uuid: string,
  kind: 'authority' | 'terms' | 'acceptance',
  config: AxiosRequestConfig = {},
) => {
  const bytes = config.responseType === 'arraybuffer';
  if (kind === 'authority')
    return bytes
      ? apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_FILE(uuid), {
          ...config,
          responseType: 'arraybuffer',
        })
      : apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_FILE(uuid), { ...config, responseType: 'blob' });
  if (kind === 'terms')
    return bytes
      ? apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_TERMS_FILE(uuid), {
          ...config,
          responseType: 'arraybuffer',
        })
      : apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_TERMS_FILE(uuid), {
          ...config,
          responseType: 'blob',
        });
  return bytes
    ? apiClient.get<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_ACCEPTANCE_FILE(uuid), {
        ...config,
        responseType: 'arraybuffer',
      })
    : apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_ACCEPTANCE_FILE(uuid), {
        ...config,
        responseType: 'blob',
      });
};

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
  const fileConfig = { ...config, responseType: 'blob' as const };
  if (kind === 'authority') return apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_FILE(uuid), fileConfig);
  if (kind === 'terms') return apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_TERMS_FILE(uuid), fileConfig);
  return apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANT_ACCEPTANCE_FILE(uuid), fileConfig);
};

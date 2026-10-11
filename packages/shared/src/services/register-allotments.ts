import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterAllotment,
  RegisterAllotmentPreparation,
  RegisterAllotmentDecisionRequest,
  RegisterAllotmentDecisionPreview,
  RegisterAllotmentDecideRequest,
  RegisterAllotmentQueryParams,
} from '../types';

export const getRegisterAllotments = (
  apiClient: AxiosInstance,
  params: RegisterAllotmentQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<PaginatedResponse<RegisterAllotment>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_ALLOTMENTS, {
    ...config,
    params,
  });

export const getRegisterAllotment = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<RegisterAllotment>(COMPANY_TOKEN_ENDPOINTS.REGISTER_ALLOTMENT(uuid), config);

export const prepareRegisterAllotment = (
  apiClient: AxiosInstance,
  data: RegisterAllotmentPreparation,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterAllotment>(COMPANY_TOKEN_ENDPOINTS.REGISTER_ALLOTMENTS, data, config);

export const previewRegisterAllotmentDecision = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterAllotmentDecisionRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient.post<RegisterAllotmentDecisionPreview>(
    COMPANY_TOKEN_ENDPOINTS.REGISTER_ALLOTMENT_PREVIEW(uuid),
    data,
    config,
  );

export const decideRegisterAllotment = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterAllotmentDecideRequest,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterAllotment>(COMPANY_TOKEN_ENDPOINTS.REGISTER_ALLOTMENT_DECIDE(uuid), data, config);

export const downloadRegisterAllotmentFile = (
  apiClient: AxiosInstance,
  uuid: string,
  kind: 'authority' | 'agreement' | 'receipt',
  config: AxiosRequestConfig = {},
) => {
  const fileConfig = { ...config, responseType: 'blob' as const };
  if (kind === 'authority')
    return apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_ALLOTMENT_FILE(uuid), fileConfig);
  if (kind === 'agreement')
    return apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_ALLOTMENT_AGREEMENT_FILE(uuid), fileConfig);
  return apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_ALLOTMENT_RECEIPT_FILE(uuid), fileConfig);
};

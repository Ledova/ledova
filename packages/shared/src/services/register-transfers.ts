import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterTransfer,
  RegisterTransferPreparation,
  RegisterTransferDecisionPreview,
  RegisterTransferDecisionRequest,
  RegisterTransferDecideRequest,
  RegisterTransferQueryParams,
  RegisterTransferMembers,
} from '../types';

export const getRegisterTransferMembers = (apiClient: AxiosInstance, token: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<RegisterTransferMembers>(COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBERS(token), config);

export const getRegisterTransfers = (
  apiClient: AxiosInstance,
  params: RegisterTransferQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<PaginatedResponse<RegisterTransfer>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_TRANSFERS, { ...config, params });

export const prepareRegisterTransfer = (
  apiClient: AxiosInstance,
  data: RegisterTransferPreparation,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterTransfer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_TRANSFERS, data, config);

export const previewRegisterTransferDecision = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterTransferDecisionRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient.post<RegisterTransferDecisionPreview>(
    COMPANY_TOKEN_ENDPOINTS.REGISTER_TRANSFER_PREVIEW(uuid),
    data,
    config,
  );

export const decideRegisterTransfer = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterTransferDecideRequest,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterTransfer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_TRANSFER_DECIDE(uuid), data, config);

export const downloadRegisterTransferFile = (
  apiClient: AxiosInstance,
  uuid: string,
  kind: 'authority' | 'instrument',
  config: AxiosRequestConfig = {},
) => {
  const fileConfig = { ...config, responseType: 'blob' as const };
  if (kind === 'authority')
    return apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_TRANSFER_FILE(uuid), fileConfig);
  return apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_TRANSFER_INSTRUMENT_FILE(uuid), fileConfig);
};

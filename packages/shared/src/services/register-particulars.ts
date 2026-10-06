import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterParticularsChange,
  RegisterParticularsChangeDecideRequest,
  RegisterParticularsChangeDecisionPreview,
  RegisterParticularsChangeDecisionRequest,
  RegisterParticularsChangePreparation,
  RegisterParticularsChangeQueryParams,
} from '../types';

export const getRegisterParticularsChanges = (
  apiClient: AxiosInstance,
  params: RegisterParticularsChangeQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<PaginatedResponse<RegisterParticularsChange>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGES, {
    ...config,
    params,
  });

export const prepareRegisterParticularsChange = (
  apiClient: AxiosInstance,
  data: RegisterParticularsChangePreparation,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterParticularsChange>(COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGES, data, config);

export const previewRegisterParticularsChangeDecision = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterParticularsChangeDecisionRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient.post<RegisterParticularsChangeDecisionPreview>(
    COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGE_PREVIEW(uuid),
    data,
    config,
  );

export const decideRegisterParticularsChange = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterParticularsChangeDecideRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient.post<RegisterParticularsChange>(
    COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGE_DECIDE(uuid),
    data,
    config,
  );

export const downloadRegisterParticularsChangeFile = (
  apiClient: AxiosInstance,
  uuid: string,
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGE_FILE(uuid), {
    ...config,
    responseType: 'blob',
  });

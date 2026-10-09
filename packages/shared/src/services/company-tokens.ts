import { AxiosInstance, type AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants';
import type {
  CompanyShareToken,
  CompanyShareTokenListItem,
  PauseSubmissionRequest,
  PauseSubmissionResponse,
  TokenCreate,
  TokenHoldersResponse,
  RegisterInspectionPreview,
  RegisterInspectionRequest,
  TokenIssuance,
  CapitalIncreaseListItem,
  PaginatedResponse,
  ShareIssuanceRequest,
  ShareIssuanceRequestQueryParams,
} from '../types';

export const getCompanyTokens = (
  apiClient: AxiosInstance,
  params?: { page?: number; page_size?: number; status?: string; company_uuid?: string },
) => apiClient.get<PaginatedResponse<CompanyShareTokenListItem>>(COMPANY_TOKEN_ENDPOINTS.BASE, { params });

export const getCompanyToken = (apiClient: AxiosInstance, uuid: string, config?: AxiosRequestConfig) =>
  apiClient.get<CompanyShareToken>(COMPANY_TOKEN_ENDPOINTS.DETAIL(uuid), config);

export const createCompanyToken = (apiClient: AxiosInstance, data: TokenCreate, config?: AxiosRequestConfig) =>
  config === undefined
    ? apiClient.post<CompanyShareToken>(COMPANY_TOKEN_ENDPOINTS.BASE, data)
    : apiClient.post<CompanyShareToken>(COMPANY_TOKEN_ENDPOINTS.BASE, data, config);

export const pauseCompanyToken = (
  apiClient: AxiosInstance,
  uuid: string,
  data: PauseSubmissionRequest,
  config?: AxiosRequestConfig,
) => apiClient.post<PauseSubmissionResponse>(COMPANY_TOKEN_ENDPOINTS.PAUSE(uuid), data, config);

export const unpauseCompanyToken = (
  apiClient: AxiosInstance,
  uuid: string,
  data: PauseSubmissionRequest,
  config?: AxiosRequestConfig,
) => apiClient.post<PauseSubmissionResponse>(COMPANY_TOKEN_ENDPOINTS.UNPAUSE(uuid), data, config);

export const getPauseSubmission = (
  apiClient: AxiosInstance,
  uuid: string,
  submissionId: string,
  config?: AxiosRequestConfig,
) => apiClient.get<PauseSubmissionResponse>(COMPANY_TOKEN_ENDPOINTS.PAUSE_SUBMISSION(uuid, submissionId), config);

export const getRegisterClasses = (
  apiClient: AxiosInstance,
  params: { page?: number; company_uuid?: string } = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<PaginatedResponse<CompanyShareTokenListItem>>(COMPANY_TOKEN_ENDPOINTS.REGISTER, { ...config, params });

export const getCompanyTokenHolders = (apiClient: AxiosInstance, uuid: string, config?: AxiosRequestConfig) =>
  config === undefined
    ? apiClient.get<TokenHoldersResponse>(COMPANY_TOKEN_ENDPOINTS.HOLDERS(uuid))
    : apiClient.get<TokenHoldersResponse>(COMPANY_TOKEN_ENDPOINTS.HOLDERS(uuid), config);

export const downloadTokenRegister = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_EXPORT(uuid), { ...config, responseType: 'blob' });

export const getRegisterInspectionPreview = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<RegisterInspectionPreview>(COMPANY_TOKEN_ENDPOINTS.REGISTER_INSPECTION_COPY(uuid), config);

export const createRegisterInspectionCopy = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterInspectionRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient.post<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_INSPECTION_COPY(uuid), data, {
    ...config,
    responseType: 'blob',
  });

export const createRegisterInspectionCopyBytes = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterInspectionRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient.post<ArrayBuffer>(COMPANY_TOKEN_ENDPOINTS.REGISTER_INSPECTION_COPY(uuid), data, {
    ...config,
    responseType: 'arraybuffer',
  });

export const getCompanyTokenIssuances = (
  apiClient: AxiosInstance,
  uuid: string,
  params?: { page?: number; page_size?: number; status?: string },
  config: AxiosRequestConfig = {},
) => apiClient.get<PaginatedResponse<TokenIssuance>>(COMPANY_TOKEN_ENDPOINTS.ISSUANCES(uuid), { ...config, params });

export const getCapitalIncreases = (
  apiClient: AxiosInstance,
  params?: { token?: string; status?: string; page?: number; page_size?: number },
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<PaginatedResponse<CapitalIncreaseListItem>>(COMPANY_TOKEN_ENDPOINTS.CAPITAL_INCREASES, {
    ...config,
    params,
  });

export const getShareIssuanceRequests = (
  apiClient: AxiosInstance,
  params?: ShareIssuanceRequestQueryParams,
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<PaginatedResponse<ShareIssuanceRequest>>(COMPANY_TOKEN_ENDPOINTS.ISSUANCE_REQUESTS, {
    ...config,
    params,
  });

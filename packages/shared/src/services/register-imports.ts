import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterImportDecideRequest,
  RegisterImportDecisionPreview,
  RegisterImportDecisionRequest,
  RegisterImportPreparation,
  RegisterImportQueryParams,
  RegisterImportRecord,
} from '../types';
import { registerImportOf } from '../utils/register-imports';

const withRows = <Response extends { data: RegisterImportRecord }>(response: Response) => ({
  ...response,
  data: registerImportOf(response.data),
});

export const prepareRegisterImport = (
  apiClient: AxiosInstance,
  data: RegisterImportPreparation,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterImportRecord>(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORTS, data, config).then(withRows);

export const getRegisterImports = (
  apiClient: AxiosInstance,
  params: RegisterImportQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient
    .get<PaginatedResponse<RegisterImportRecord>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORTS, { ...config, params })
    .then((response) => ({
      ...response,
      data: { ...response.data, results: response.data.results.map(registerImportOf) },
    }));

export const previewRegisterImportDecision = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterImportDecisionRequest,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterImportDecisionPreview>(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_PREVIEW(uuid), data, config);

export const decideRegisterImport = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterImportDecideRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient
    .post<RegisterImportRecord>(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_DECIDE(uuid), data, config)
    .then(withRows);

export const downloadRegisterImportFile = (
  apiClient: AxiosInstance,
  uuid: string,
  copy: 'register' | 'asic',
  config: AxiosRequestConfig = {},
) =>
  copy === 'asic'
    ? apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_ASIC_FILE(uuid), { ...config, responseType: 'blob' })
    : apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORT_FILE(uuid), { ...config, responseType: 'blob' });

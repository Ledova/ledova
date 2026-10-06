import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterOpeningDecideRequest,
  RegisterOpeningDecisionPreview,
  RegisterOpeningDecisionRequest,
  RegisterOpeningHolders,
  RegisterOpeningPreparation,
  RegisterOpeningQueryParams,
  RegisterOpeningRecord,
} from '../types';
import { registerOpeningOf } from '../utils/register-openings';

const withMapping = <Response extends { data: RegisterOpeningRecord }>(response: Response) => ({
  ...response,
  data: registerOpeningOf(response.data),
});

export const getRegisterOpeningHolders = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<RegisterOpeningHolders>(COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENING_HOLDERS(uuid), config);

export const getRegisterOpenings = (
  apiClient: AxiosInstance,
  params: RegisterOpeningQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient
    .get<PaginatedResponse<RegisterOpeningRecord>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENINGS, { ...config, params })
    .then((response) => ({
      ...response,
      data: { ...response.data, results: response.data.results.map(registerOpeningOf) },
    }));

export const prepareRegisterOpening = (
  apiClient: AxiosInstance,
  data: RegisterOpeningPreparation,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterOpeningRecord>(COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENINGS, data, config).then(withMapping);

export const previewRegisterOpeningDecision = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterOpeningDecisionRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient.post<RegisterOpeningDecisionPreview>(COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENING_PREVIEW(uuid), data, config);

export const decideRegisterOpening = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterOpeningDecideRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient
    .post<RegisterOpeningRecord>(COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENING_DECIDE(uuid), data, config)
    .then(withMapping);

export const downloadRegisterOpeningFile = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENING_FILE(uuid), { ...config, responseType: 'blob' });

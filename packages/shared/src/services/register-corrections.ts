import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterCorrectionDecideRequest,
  RegisterCorrectionDecisionPreview,
  RegisterCorrectionDecisionRequest,
  RegisterCorrectionPreparation,
  RegisterCorrectionQueryParams,
  RegisterCorrectionRecord,
  RegisterEntry,
  RegisterEntryQueryParams,
} from '../types';
import { registerCorrectionOf } from '../utils/register-corrections';

const withChanges = <Response extends { data: RegisterCorrectionRecord }>(response: Response) => ({
  ...response,
  data: registerCorrectionOf(response.data),
});

export const getRegisterEntries = (
  apiClient: AxiosInstance,
  uuid: string,
  params: RegisterEntryQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<PaginatedResponse<RegisterEntry>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_ENTRIES(uuid), {
    ...config,
    params,
  });

export const getRegisterCorrections = (
  apiClient: AxiosInstance,
  params: RegisterCorrectionQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient
    .get<PaginatedResponse<RegisterCorrectionRecord>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_CORRECTIONS, {
      ...config,
      params,
    })
    .then((response) => ({
      ...response,
      data: { ...response.data, results: response.data.results.map(registerCorrectionOf) },
    }));

export const prepareRegisterCorrection = (
  apiClient: AxiosInstance,
  data: RegisterCorrectionPreparation,
  config: AxiosRequestConfig = {},
) =>
  apiClient
    .post<RegisterCorrectionRecord>(COMPANY_TOKEN_ENDPOINTS.REGISTER_CORRECTIONS, data, config)
    .then(withChanges);

export const previewRegisterCorrectionDecision = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterCorrectionDecisionRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient.post<RegisterCorrectionDecisionPreview>(
    COMPANY_TOKEN_ENDPOINTS.REGISTER_CORRECTION_PREVIEW(uuid),
    data,
    config,
  );

export const decideRegisterCorrection = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterCorrectionDecideRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient
    .post<RegisterCorrectionRecord>(COMPANY_TOKEN_ENDPOINTS.REGISTER_CORRECTION_DECIDE(uuid), data, config)
    .then(withChanges);

export const downloadRegisterCorrectionFile = (
  apiClient: AxiosInstance,
  uuid: string,
  config: AxiosRequestConfig = {},
) => apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_CORRECTION_FILE(uuid), { ...config, responseType: 'blob' });

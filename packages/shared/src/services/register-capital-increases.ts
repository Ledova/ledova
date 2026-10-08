import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS as URLS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterCapitalIncrease,
  RegisterCapitalIncreasePreparation,
  RegisterCapitalIncreaseDecisionRequest,
  RegisterCapitalIncreaseDecideRequest,
  RegisterCapitalIncreaseDecisionPreview,
  RegisterCapitalIncreaseQuery,
} from '../types';

export const getRegisterCapitalIncreases = (
  api: AxiosInstance,
  params: RegisterCapitalIncreaseQuery = {},
  config: AxiosRequestConfig = {},
) => api.get<PaginatedResponse<RegisterCapitalIncrease>>(URLS.REGISTER_CAPITAL_INCREASES, { ...config, params });
export const getRegisterCapitalIncrease = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<RegisterCapitalIncrease>(URLS.REGISTER_CAPITAL_INCREASE(uuid), config);
export const prepareRegisterCapitalIncrease = (
  api: AxiosInstance,
  data: RegisterCapitalIncreasePreparation,
  config: AxiosRequestConfig = {},
) => api.post<RegisterCapitalIncrease>(URLS.REGISTER_CAPITAL_INCREASES, data, config);
export const previewRegisterCapitalIncreaseDecision = (
  api: AxiosInstance,
  uuid: string,
  data: RegisterCapitalIncreaseDecisionRequest,
  config: AxiosRequestConfig = {},
) => api.post<RegisterCapitalIncreaseDecisionPreview>(URLS.REGISTER_CAPITAL_INCREASE_PREVIEW(uuid), data, config);
export const decideRegisterCapitalIncrease = (
  api: AxiosInstance,
  uuid: string,
  data: RegisterCapitalIncreaseDecideRequest,
  config: AxiosRequestConfig = {},
) => api.post<RegisterCapitalIncrease>(URLS.REGISTER_CAPITAL_INCREASE_DECIDE(uuid), data, config);
export const downloadRegisterCapitalIncreaseFile = (
  api: AxiosInstance,
  uuid: string,
  config: AxiosRequestConfig = {},
) => api.get<Blob>(URLS.REGISTER_CAPITAL_INCREASE_FILE(uuid), { ...config, responseType: 'blob' });

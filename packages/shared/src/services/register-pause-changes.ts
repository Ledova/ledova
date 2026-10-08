import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS as URLS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterPauseChange,
  RegisterPauseChangePreparation,
  RegisterPauseChangeDecisionRequest,
  RegisterPauseChangeDecideRequest,
  RegisterPauseChangeDecisionPreview,
  RegisterPauseChangeQuery,
} from '../types';

export const getRegisterPauseChanges = (
  api: AxiosInstance,
  params: RegisterPauseChangeQuery = {},
  config: AxiosRequestConfig = {},
) => api.get<PaginatedResponse<RegisterPauseChange>>(URLS.REGISTER_PAUSE_CHANGES, { ...config, params });
export const getRegisterPauseChange = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<RegisterPauseChange>(URLS.REGISTER_PAUSE_CHANGE(uuid), config);
export const prepareRegisterPauseChange = (
  api: AxiosInstance,
  data: RegisterPauseChangePreparation,
  config: AxiosRequestConfig = {},
) => api.post<RegisterPauseChange>(URLS.REGISTER_PAUSE_CHANGES, data, config);
export const previewRegisterPauseChangeDecision = (
  api: AxiosInstance,
  uuid: string,
  data: RegisterPauseChangeDecisionRequest,
  config: AxiosRequestConfig = {},
) => api.post<RegisterPauseChangeDecisionPreview>(URLS.REGISTER_PAUSE_CHANGE_PREVIEW(uuid), data, config);
export const decideRegisterPauseChange = (
  api: AxiosInstance,
  uuid: string,
  data: RegisterPauseChangeDecideRequest,
  config: AxiosRequestConfig = {},
) => api.post<RegisterPauseChange>(URLS.REGISTER_PAUSE_CHANGE_DECIDE(uuid), data, config);
export const downloadRegisterPauseChangeFile = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<Blob>(URLS.REGISTER_PAUSE_CHANGE_FILE(uuid), { ...config, responseType: 'blob' });

import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS as URLS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterIssue,
  RegisterIssuePreparation,
  RegisterIssueDecisionRequest,
  RegisterIssueDecideRequest,
  RegisterIssueDecisionPreview,
  RegisterIssueQuery,
} from '../types';

export const getRegisterIssues = (
  api: AxiosInstance,
  params: RegisterIssueQuery = {},
  config: AxiosRequestConfig = {},
) => api.get<PaginatedResponse<RegisterIssue>>(URLS.REGISTER_ISSUES, { ...config, params });
export const getRegisterIssue = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<RegisterIssue>(`${URLS.REGISTER_ISSUES}${uuid}/`, config);
export const prepareRegisterIssue = (
  api: AxiosInstance,
  data: RegisterIssuePreparation,
  config: AxiosRequestConfig = {},
) => api.post<RegisterIssue>(URLS.REGISTER_ISSUES, data, config);
export const previewRegisterIssueDecision = (
  api: AxiosInstance,
  uuid: string,
  data: RegisterIssueDecisionRequest,
  config: AxiosRequestConfig = {},
) => api.post<RegisterIssueDecisionPreview>(URLS.REGISTER_ISSUE_PREVIEW(uuid), data, config);
export const decideRegisterIssue = (
  api: AxiosInstance,
  uuid: string,
  data: RegisterIssueDecideRequest,
  config: AxiosRequestConfig = {},
) => api.post<RegisterIssue>(URLS.REGISTER_ISSUE_DECIDE(uuid), data, config);
export const downloadRegisterIssueFile = (
  api: AxiosInstance,
  uuid: string,
  kind: 'authority' | 'terms' | 'acceptance',
  config: AxiosRequestConfig = {},
) => {
  const fileConfig = { ...config, responseType: 'blob' as const };
  if (kind === 'authority') return api.get<Blob>(URLS.REGISTER_ISSUE_FILE(uuid), fileConfig);
  if (kind === 'terms') return api.get<Blob>(URLS.REGISTER_ISSUE_TERMS_FILE(uuid), fileConfig);
  return api.get<Blob>(URLS.REGISTER_ISSUE_ACCEPTANCE_FILE(uuid), fileConfig);
};

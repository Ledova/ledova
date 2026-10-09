import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS as URLS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterPaidIssue,
  RegisterPaidIssueSource,
  RegisterPaidIssuePreparation,
  RegisterPaidIssueDecisionRequest,
  RegisterPaidIssueDecideRequest,
  RegisterPaidIssueDecisionPreview,
  RegisterPaidIssueQuery,
  RegisterPaidIssueSourceQuery,
} from '../types';

export const getRegisterPaidIssues = (
  api: AxiosInstance,
  params: RegisterPaidIssueQuery = {},
  config: AxiosRequestConfig = {},
) => api.get<PaginatedResponse<RegisterPaidIssue>>(URLS.REGISTER_PAID_ISSUES, { ...config, params });
export const getRegisterPaidIssue = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<RegisterPaidIssue>(URLS.REGISTER_PAID_ISSUE(uuid), config);
export const getRegisterPaidIssueSubscriptions = (
  api: AxiosInstance,
  params: RegisterPaidIssueSourceQuery,
  config: AxiosRequestConfig = {},
) => api.get<RegisterPaidIssueSource[]>(URLS.REGISTER_PAID_ISSUE_SUBSCRIPTIONS, { ...config, params });
export const prepareRegisterPaidIssue = (
  api: AxiosInstance,
  data: RegisterPaidIssuePreparation,
  config: AxiosRequestConfig = {},
) => api.post<RegisterPaidIssue>(URLS.REGISTER_PAID_ISSUES, data, config);
export const previewRegisterPaidIssueDecision = (
  api: AxiosInstance,
  uuid: string,
  data: RegisterPaidIssueDecisionRequest,
  config: AxiosRequestConfig = {},
) => api.post<RegisterPaidIssueDecisionPreview>(URLS.REGISTER_PAID_ISSUE_PREVIEW(uuid), data, config);
export const decideRegisterPaidIssue = (
  api: AxiosInstance,
  uuid: string,
  data: RegisterPaidIssueDecideRequest,
  config: AxiosRequestConfig = {},
) => api.post<RegisterPaidIssue>(URLS.REGISTER_PAID_ISSUE_DECIDE(uuid), data, config);
export const downloadRegisterPaidIssueFile = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<Blob>(URLS.REGISTER_PAID_ISSUE_FILE(uuid), { ...config, responseType: 'blob' });

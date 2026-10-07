import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterLinkDecideRequest,
  RegisterLinkDecisionPreview,
  RegisterLinkDecisionRequest,
  RegisterLinkPreparation,
  RegisterLinkQueryParams,
  RegisterLinkRecord,
  RegisterWaitingWallets,
} from '../types';
import { readEveryPage } from '../utils/pagination';
import { registerLinkOf } from '../utils/register-links';

const withMapping = <Response extends { data: RegisterLinkRecord }>(response: Response) => ({
  ...response,
  data: registerLinkOf(response.data),
});

export const getRegisterLinks = (
  apiClient: AxiosInstance,
  params: RegisterLinkQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  readEveryPage((page) =>
    apiClient.get<PaginatedResponse<RegisterLinkRecord>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_LINKS, {
      ...config,
      params: { ...params, page },
    }),
  ).then((links) => links.map(registerLinkOf));

export const getRegisterWaitingWallets = (apiClient: AxiosInstance, company: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<RegisterWaitingWallets>(COMPANY_TOKEN_ENDPOINTS.REGISTER_LINK_WAITING_WALLETS, {
    ...config,
    params: { company },
  });

export const prepareRegisterLink = (
  apiClient: AxiosInstance,
  data: RegisterLinkPreparation,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterLinkRecord>(COMPANY_TOKEN_ENDPOINTS.REGISTER_LINKS, data, config).then(withMapping);

export const previewRegisterLinkDecision = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterLinkDecisionRequest,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterLinkDecisionPreview>(COMPANY_TOKEN_ENDPOINTS.REGISTER_LINK_PREVIEW(uuid), data, config);

export const decideRegisterLink = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterLinkDecideRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient
    .post<RegisterLinkRecord>(COMPANY_TOKEN_ENDPOINTS.REGISTER_LINK_DECIDE(uuid), data, config)
    .then(withMapping);

export const downloadRegisterLinkFile = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_LINK_FILE(uuid), { ...config, responseType: 'blob' });

import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterDeployment,
  RegisterDeploymentDecideRequest,
  RegisterDeploymentDecisionPreview,
  RegisterDeploymentDecisionRequest,
  RegisterDeploymentPreparation,
  RegisterDeploymentQueryParams,
} from '../types';

export const getRegisterDeployments = (
  apiClient: AxiosInstance,
  params: RegisterDeploymentQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<PaginatedResponse<RegisterDeployment>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_DEPLOYMENTS, {
    ...config,
    params,
  });

export const prepareRegisterDeployment = (
  apiClient: AxiosInstance,
  data: RegisterDeploymentPreparation,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterDeployment>(COMPANY_TOKEN_ENDPOINTS.REGISTER_DEPLOYMENTS, data, config);

export const retrieveRegisterDeployment = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<RegisterDeployment>(COMPANY_TOKEN_ENDPOINTS.REGISTER_DEPLOYMENT_DETAIL(uuid), config);

export const previewRegisterDeploymentDecision = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterDeploymentDecisionRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient.post<RegisterDeploymentDecisionPreview>(
    COMPANY_TOKEN_ENDPOINTS.REGISTER_DEPLOYMENT_PREVIEW(uuid),
    data,
    config,
  );

export const decideRegisterDeployment = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterDeploymentDecideRequest,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterDeployment>(COMPANY_TOKEN_ENDPOINTS.REGISTER_DEPLOYMENT_DECIDE(uuid), data, config);

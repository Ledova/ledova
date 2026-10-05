import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterAcknowledgeRequest,
  RegisterReconciliation,
  RegisterReconciliationQueryParams,
} from '../types';
import { registerReconciliationOf } from '../utils/register-reconciliations';

const withRows = <Response extends { data: RegisterReconciliation }>(response: Response) => ({
  ...response,
  data: registerReconciliationOf(response.data),
});

export const getRegisterReconciliations = (
  apiClient: AxiosInstance,
  params: RegisterReconciliationQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient
    .get<PaginatedResponse<RegisterReconciliation>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_RECONCILIATIONS, {
      ...config,
      params,
    })
    .then((response) => ({
      ...response,
      data: { ...response.data, results: response.data.results.map(registerReconciliationOf) },
    }));

export const getRegisterReconciliation = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<RegisterReconciliation>(COMPANY_TOKEN_ENDPOINTS.REGISTER_RECONCILIATION(uuid), config).then(withRows);

export const acknowledgeRegisterDiscrepancy = (
  apiClient: AxiosInstance,
  uuid: string,
  data: RegisterAcknowledgeRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient
    .post<RegisterReconciliation>(COMPANY_TOKEN_ENDPOINTS.REGISTER_RECONCILIATION_ACKNOWLEDGE(uuid), data, config)
    .then(withRows);

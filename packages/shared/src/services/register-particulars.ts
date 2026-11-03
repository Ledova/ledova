import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterParticularsChange,
  RegisterParticularsChangeQueryParams,
  RegisterParticularsEdit,
} from '../types';

export const getRegisterParticularsChanges = (
  apiClient: AxiosInstance,
  params: RegisterParticularsChangeQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<PaginatedResponse<RegisterParticularsChange>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGES, {
    ...config,
    params,
  });

export const editRegisterParticulars = (
  apiClient: AxiosInstance,
  data: RegisterParticularsEdit,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterParticularsChange>(COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGES, data, config);

export const downloadRegisterParticularsChangeFile = (
  apiClient: AxiosInstance,
  uuid: string,
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGE_FILE(uuid), {
    ...config,
    responseType: 'blob',
  });

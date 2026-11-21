import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type { PaginatedResponse, RegisterEntry, RegisterEntryQueryParams } from '../types';

export const getRegisterEntries = (
  apiClient: AxiosInstance,
  uuid: string,
  params: RegisterEntryQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<PaginatedResponse<RegisterEntry>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_ENTRIES(uuid), {
    ...config,
    params,
    paramsSerializer: { indexes: null },
  });

export const deleteRegisterEntry = (
  apiClient: AxiosInstance,
  token: string,
  entry: string,
  config: AxiosRequestConfig = {},
) => apiClient.delete<void>(`${COMPANY_TOKEN_ENDPOINTS.REGISTER_ENTRIES(token)}${entry}/`, config);

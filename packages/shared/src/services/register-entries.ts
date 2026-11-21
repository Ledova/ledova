import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';

export const deleteRegisterEntry = (
  apiClient: AxiosInstance,
  token: string,
  entry: string,
  config: AxiosRequestConfig = {},
) => apiClient.delete<void>(`${COMPANY_TOKEN_ENDPOINTS.REGISTER_ENTRIES(token)}${entry}/`, config);

import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type {
  ClassRightsFileQuery,
  ClassRightsHistory,
  ClassRightsQuery,
  ClassRightsRequest,
  ClassRightsRevision,
} from '../types';

export const getClassRights = (
  api: AxiosInstance,
  uuid: string,
  params: ClassRightsQuery = {},
  config: AxiosRequestConfig = {},
) => api.get<ClassRightsHistory>(COMPANY_TOKEN_ENDPOINTS.CLASS_RIGHTS(uuid), { ...config, params });

export const recordClassRights = (
  api: AxiosInstance,
  uuid: string,
  data: ClassRightsRequest,
  config: AxiosRequestConfig = {},
) => api.post<ClassRightsRevision>(COMPANY_TOKEN_ENDPOINTS.CLASS_RIGHTS(uuid), data, config);

export const downloadClassRightsFile = (
  api: AxiosInstance,
  uuid: string,
  params: ClassRightsFileQuery,
  config: AxiosRequestConfig = {},
) => api.get<Blob>(COMPANY_TOKEN_ENDPOINTS.CLASS_RIGHTS_FILE(uuid), { ...config, params, responseType: 'blob' });

import { AxiosInstance, type AxiosRequestConfig } from 'axios';
import { PUBLICATION_ENDPOINTS } from '../constants';
import type { PaginatedResponse, Publication } from '../types';

export const getPublications = (apiClient: AxiosInstance) =>
  apiClient.get<PaginatedResponse<Publication>>(PUBLICATION_ENDPOINTS.BASE);

export const openPublication = (apiClient: AxiosInstance, uuid: string) =>
  apiClient.get<Blob>(PUBLICATION_ENDPOINTS.FILE(uuid), { responseType: 'blob' });

export const downloadPublication = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<ArrayBuffer>(PUBLICATION_ENDPOINTS.FILE(uuid), { ...config, responseType: 'arraybuffer' });

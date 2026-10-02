import { AxiosInstance, type AxiosRequestConfig } from 'axios';
import { DIRECTORY_ENDPOINTS } from '../constants';
import type { DirectoryDocument, DirectoryToken, PaginatedResponse } from '../types';

export const getDirectoryTokens = (apiClient: AxiosInstance, page?: number) =>
  page === undefined
    ? apiClient.get<PaginatedResponse<DirectoryToken>>(DIRECTORY_ENDPOINTS.TOKENS.LIST)
    : apiClient.get<PaginatedResponse<DirectoryToken>>(DIRECTORY_ENDPOINTS.TOKENS.LIST, { params: { page } });

export const getDirectoryToken = (apiClient: AxiosInstance, uuid: string) =>
  apiClient.get<DirectoryToken>(DIRECTORY_ENDPOINTS.TOKENS.DETAIL(uuid));

export const getDirectoryDocuments = (apiClient: AxiosInstance, uuid: string) =>
  apiClient.get<DirectoryDocument[]>(DIRECTORY_ENDPOINTS.TOKENS.DOCUMENTS(uuid));

export const downloadDirectoryDocument = (
  apiClient: AxiosInstance,
  uuid: string,
  document: string,
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<ArrayBuffer>(DIRECTORY_ENDPOINTS.TOKENS.DOCUMENT_FILE(uuid, document), {
    ...config,
    responseType: 'arraybuffer',
  });

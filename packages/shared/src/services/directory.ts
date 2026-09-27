import { AxiosInstance } from 'axios';
import { DIRECTORY_ENDPOINTS } from '../constants';
import type { DirectoryToken, PaginatedResponse } from '../types';

export const getDirectoryTokens = (apiClient: AxiosInstance, page?: number) =>
  page === undefined
    ? apiClient.get<PaginatedResponse<DirectoryToken>>(DIRECTORY_ENDPOINTS.TOKENS.LIST)
    : apiClient.get<PaginatedResponse<DirectoryToken>>(DIRECTORY_ENDPOINTS.TOKENS.LIST, { params: { page } });

export const getDirectoryToken = (apiClient: AxiosInstance, uuid: string) =>
  apiClient.get<DirectoryToken>(DIRECTORY_ENDPOINTS.TOKENS.DETAIL(uuid));

import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { USER_DOCUMENT_ENDPOINTS } from '../constants';
import type { ApiRequest, ApiResponse, Document, UploadFile } from '../types';

export const listDocuments = (apiClient: AxiosInstance, page = 1, config?: AxiosRequestConfig) =>
  apiClient.get<ApiResponse<'api_v1_documents_list'>>(USER_DOCUMENT_ENDPOINTS.BASE, { ...config, params: { page } });

export const getDocument = (apiClient: AxiosInstance, uuid: string, config?: AxiosRequestConfig) =>
  apiClient.get<Document>(USER_DOCUMENT_ENDPOINTS.DETAIL(uuid), config);

export type UploadDocumentInput = Omit<ApiRequest<'api_v1_documents_create'>, 'file'> & { file: UploadFile };

export const uploadDocument = (apiClient: AxiosInstance, input: UploadDocumentInput, config?: AxiosRequestConfig) => {
  const form = new FormData();
  form.append('file', input.file as Blob);
  if (input.documentType) form.append('document_type', input.documentType);
  if (input.note) form.append('note', input.note);
  if (input.classification) form.append('classification', input.classification);

  return apiClient.post<Document>(USER_DOCUMENT_ENDPOINTS.BASE, form, {
    ...config,
    headers: { ...config?.headers, 'Content-Type': 'multipart/form-data' },
  });
};

export const deleteDocument = (apiClient: AxiosInstance, uuid: string, config?: AxiosRequestConfig) =>
  apiClient.delete(USER_DOCUMENT_ENDPOINTS.DETAIL(uuid), config);

export const attachDocument = (
  apiClient: AxiosInstance,
  uuid: string,
  classification: string,
  config?: AxiosRequestConfig,
) => apiClient.post<Document>(USER_DOCUMENT_ENDPOINTS.ATTACH(uuid), { classification }, config);

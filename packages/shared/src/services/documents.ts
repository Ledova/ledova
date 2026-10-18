import type { AxiosInstance } from 'axios';
import { USER_DOCUMENT_ENDPOINTS } from '../constants';
import type { ApiRequest, ApiResponse, Document } from '../types';

export const listDocuments = (apiClient: AxiosInstance) =>
  apiClient.get<ApiResponse<'api_v1_documents_list'>>(USER_DOCUMENT_ENDPOINTS.BASE);

export const getDocument = (apiClient: AxiosInstance, uuid: string) =>
  apiClient.get<Document>(USER_DOCUMENT_ENDPOINTS.DETAIL(uuid));

export type UploadDocumentInput = ApiRequest<'api_v1_documents_create'>;

export const uploadDocument = (apiClient: AxiosInstance, input: UploadDocumentInput) => {
  const form = new FormData();
  form.append('file', input.file);
  if (input.documentType) form.append('document_type', input.documentType);
  if (input.note) form.append('note', input.note);
  if (input.classification) form.append('classification', input.classification);

  return apiClient.post<Document>(USER_DOCUMENT_ENDPOINTS.BASE, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const deleteDocument = (apiClient: AxiosInstance, uuid: string) =>
  apiClient.delete(USER_DOCUMENT_ENDPOINTS.DETAIL(uuid));

export const attachDocument = (apiClient: AxiosInstance, uuid: string, classification: string) =>
  apiClient.post<Document>(USER_DOCUMENT_ENDPOINTS.ATTACH(uuid), { classification });

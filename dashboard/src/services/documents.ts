import type { AxiosInstance } from 'axios';
import type { ApiRequest, ApiResponse } from '@ledova/shared';
import type { Document } from '../types/document';

export const listDocuments = (apiClient: AxiosInstance) =>
  apiClient.get<ApiResponse<'api_v1_documents_list'>>('/api/v1/documents/');

export const getDocument = (apiClient: AxiosInstance, uuid: string) =>
  apiClient.get<Document>(`/api/v1/documents/${uuid}/`);

export type UploadDocumentInput = ApiRequest<'api_v1_documents_create'>;

export const uploadDocument = (apiClient: AxiosInstance, input: UploadDocumentInput) => {
  const form = new FormData();
  form.append('file', input.file);
  if (input.documentType) form.append('document_type', input.documentType);
  if (input.note) form.append('note', input.note);
  if (input.classification) form.append('classification', input.classification);

  return apiClient.post<Document>('/api/v1/documents/', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const deleteDocument = (apiClient: AxiosInstance, uuid: string) =>
  apiClient.delete(`/api/v1/documents/${uuid}/`);

export const attachDocument = (apiClient: AxiosInstance, uuid: string, classification: string) =>
  apiClient.post<Document>(`/api/v1/documents/${uuid}/attach/`, { classification });

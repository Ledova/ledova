import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterMemberDocument,
  RegisterMemberDocumentRecord,
  RegisterMemberDocumentQuery,
  RegisterMemberDocumentRequest,
} from '../types';
import { isRegisterMemberDocument } from '../utils/register-member-documents';

export const getRegisterMemberDocuments = (
  apiClient: AxiosInstance,
  params: RegisterMemberDocumentQuery,
  config: AxiosRequestConfig = {},
) =>
  apiClient
    .get<PaginatedResponse<RegisterMemberDocumentRecord>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBER_DOCUMENTS, {
      ...config,
      params: { ...params, idempotency_key: params.idempotencyKey, idempotencyKey: undefined },
    })
    .then((response) => {
      if (!Array.isArray(response.data.results)) throw new Error('The shareholder documents could not be read.');
      const results = response.data.results.map((row): RegisterMemberDocument => {
        if (
          !isRegisterMemberDocument(row) ||
          row.company !== params.company ||
          (params.member && row.member !== params.member) ||
          (params.token && row.token !== params.token) ||
          (params.idempotencyKey && row.idempotencyKey !== params.idempotencyKey)
        )
          throw new Error('The shareholder documents could not be read.');
        return row;
      });
      return { ...response, data: { ...response.data, results } };
    });

export const createRegisterMemberDocument = (
  apiClient: AxiosInstance,
  data: RegisterMemberDocumentRequest,
  config: AxiosRequestConfig = {},
) =>
  apiClient
    .post<RegisterMemberDocumentRecord>(COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBER_DOCUMENTS, data, config)
    .then((response) => {
      if (!isRegisterMemberDocument(response.data)) throw new Error('The shareholder document could not be confirmed.');
      return { ...response, data: response.data };
    });

export const downloadRegisterMemberDocumentFile = (
  apiClient: AxiosInstance,
  uuid: string,
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBER_DOCUMENT_FILE(uuid), {
    ...config,
    responseType: 'blob',
  });

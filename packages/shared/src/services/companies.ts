import { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_ENDPOINTS } from '../constants';
import type {
  Company,
  CompanyListItem,
  CompanyUpdate,
  CompanyUpdateResponse,
  CompanyRegistration,
  CompanyRegistrationResponse,
  CompanyDocument,
  DocumentUpload,
  CompanyActivate,
  CompanyActivated,
  PaginatedResponse,
} from '../types';

export const getCompanies = (apiClient: AxiosInstance, page?: number, config?: AxiosRequestConfig) =>
  page === undefined && config === undefined
    ? apiClient.get<PaginatedResponse<CompanyListItem>>(COMPANY_ENDPOINTS.BASE)
    : apiClient.get<PaginatedResponse<CompanyListItem>>(COMPANY_ENDPOINTS.BASE, {
        ...config,
        ...(page === undefined ? {} : { params: { page } }),
      });

export const registerCompany = (apiClient: AxiosInstance, data: CompanyRegistration) =>
  apiClient.post<CompanyRegistrationResponse>(COMPANY_ENDPOINTS.BASE, data);

export const getCompany = (apiClient: AxiosInstance, uuid: string, config?: AxiosRequestConfig) =>
  config === undefined
    ? apiClient.get<Company>(COMPANY_ENDPOINTS.DETAIL(uuid))
    : apiClient.get<Company>(COMPANY_ENDPOINTS.DETAIL(uuid), config);

export const updateCompany = (
  apiClient: AxiosInstance,
  uuid: string,
  data: CompanyUpdate,
  config?: AxiosRequestConfig,
) =>
  config === undefined
    ? apiClient.patch<CompanyUpdateResponse>(COMPANY_ENDPOINTS.DETAIL(uuid), data)
    : apiClient.patch<CompanyUpdateResponse>(COMPANY_ENDPOINTS.DETAIL(uuid), data, config);

export const uploadCompanyDocument = (
  apiClient: AxiosInstance,
  companyUuid: string,
  data: DocumentUpload,
  config?: AxiosRequestConfig,
) => {
  const formData = new FormData();
  formData.append('file', data.file);
  formData.append('document_type', data.documentType);
  formData.append('name', data.name);

  return apiClient.post<CompanyDocument>(COMPANY_ENDPOINTS.DOCUMENTS(companyUuid), formData, {
    ...config,
    headers: { ...config?.headers, 'Content-Type': 'multipart/form-data' },
  });
};

export const deleteCompanyDocument = (
  apiClient: AxiosInstance,
  companyUuid: string,
  documentUuid: string,
  config?: AxiosRequestConfig,
) =>
  config === undefined
    ? apiClient.delete(COMPANY_ENDPOINTS.DOCUMENT_DETAIL(companyUuid, documentUuid))
    : apiClient.delete(COMPANY_ENDPOINTS.DOCUMENT_DETAIL(companyUuid, documentUuid), config);

export const activateCompany = (
  apiClient: AxiosInstance,
  companyUuid: string,
  data: CompanyActivate,
  config?: AxiosRequestConfig,
) =>
  config === undefined
    ? apiClient.post<CompanyActivated>(COMPANY_ENDPOINTS.ACTIVATE(companyUuid), data)
    : apiClient.post<CompanyActivated>(COMPANY_ENDPOINTS.ACTIVATE(companyUuid), data, config);

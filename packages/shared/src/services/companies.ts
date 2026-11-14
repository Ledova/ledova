import { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_ENDPOINTS } from '../constants';
import type {
  Company,
  CompanyListItem,
  CompanyUpdate,
  CompanyUpdateResponse,
  CompanyRegistration,
  CompanyRegistrationResponse,
  CompanyPackRequest,
  CompanyPacks,
  PaginatedResponse,
} from '../types';

export const getCompanies = (apiClient: AxiosInstance, page?: number, config?: AxiosRequestConfig) =>
  page === undefined && config === undefined
    ? apiClient.get<PaginatedResponse<CompanyListItem>>(COMPANY_ENDPOINTS.BASE)
    : apiClient.get<PaginatedResponse<CompanyListItem>>(COMPANY_ENDPOINTS.BASE, {
        ...config,
        ...(page === undefined ? {} : { params: { page } }),
      });

export const registerCompany = (apiClient: AxiosInstance, data: CompanyRegistration, config?: AxiosRequestConfig) =>
  apiClient.post<CompanyRegistrationResponse>(COMPANY_ENDPOINTS.BASE, data, config);

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

export const createCompanyPack = (
  apiClient: AxiosInstance,
  companyUuid: string,
  data: CompanyPackRequest,
  config: AxiosRequestConfig = {},
) =>
  config.responseType === 'arraybuffer'
    ? apiClient.post<ArrayBuffer>(COMPANY_ENDPOINTS.PACK(companyUuid), data, { ...config, responseType: 'arraybuffer' })
    : apiClient.post<Blob>(COMPANY_ENDPOINTS.PACK(companyUuid), data, { ...config, responseType: 'blob' });

export const getCompanyPacks = (apiClient: AxiosInstance, companyUuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<CompanyPacks>(COMPANY_ENDPOINTS.PACKS(companyUuid), config);

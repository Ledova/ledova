import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import type {
  ApiResponse,
  CompanyEligibilityDecisionCreate,
  CompanyEligibilityDecisionPreview,
  CompanyEligibilityRequestCreate,
  CompanyEligibilityRequestPreview,
  CompanyEligibilityRevocationCreate,
  CompanyEligibilityWithdrawalCreate,
} from '../types';

const own = '/api/v1/company-eligibility/requests/';
const company = (uuid: string) => `/api/v1/companies/${uuid}/eligibility-requests/`;

export const getEligibilityRequests = (api: AxiosInstance, page = 1, config: AxiosRequestConfig = {}) =>
  api.get<ApiResponse<'api_v1_company_eligibility_requests_list'>>(own, { ...config, params: { page } });
export const getEligibilityRequest = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<ApiResponse<'api_v1_company_eligibility_requests_retrieve'>>(`${own}${uuid}/`, config);
export const previewEligibilityRequest = (
  api: AxiosInstance,
  data: CompanyEligibilityRequestPreview,
  config: AxiosRequestConfig = {},
) => api.post<ApiResponse<'api_v1_company_eligibility_requests_preview_create'>>(`${own}preview/`, data, config);
export const createEligibilityRequest = (
  api: AxiosInstance,
  data: CompanyEligibilityRequestCreate,
  config: AxiosRequestConfig = {},
) => api.post<ApiResponse<'api_v1_company_eligibility_requests_create'>>(own, data, config);
export const withdrawEligibilityRequest = (
  api: AxiosInstance,
  uuid: string,
  data: CompanyEligibilityWithdrawalCreate,
  config: AxiosRequestConfig = {},
) =>
  api.post<ApiResponse<'api_v1_company_eligibility_requests_withdraw_create'>>(`${own}${uuid}/withdraw/`, data, config);
export const getCompanyEligibilityRequests = (
  api: AxiosInstance,
  companyUuid: string,
  page = 1,
  config: AxiosRequestConfig = {},
) =>
  api.get<ApiResponse<'api_v1_companies_eligibility_requests_list'>>(company(companyUuid), {
    ...config,
    params: { page },
  });
export const getCompanyEligibilityRequest = (
  api: AxiosInstance,
  companyUuid: string,
  uuid: string,
  config: AxiosRequestConfig = {},
) => api.get<ApiResponse<'api_v1_companies_eligibility_requests_retrieve'>>(`${company(companyUuid)}${uuid}/`, config);
export const previewEligibilityDecision = (
  api: AxiosInstance,
  companyUuid: string,
  uuid: string,
  data: CompanyEligibilityDecisionPreview,
  config: AxiosRequestConfig = {},
) =>
  api.post<ApiResponse<'api_v1_companies_eligibility_requests_decision_preview_create'>>(
    `${company(companyUuid)}${uuid}/decision-preview/`,
    data,
    config,
  );
export const decideEligibilityRequest = (
  api: AxiosInstance,
  companyUuid: string,
  uuid: string,
  data: CompanyEligibilityDecisionCreate,
  config: AxiosRequestConfig = {},
) =>
  api.post<ApiResponse<'api_v1_companies_eligibility_requests_decide_create'>>(
    `${company(companyUuid)}${uuid}/decide/`,
    data,
    config,
  );
export const revokeEligibilityDecision = (
  api: AxiosInstance,
  companyUuid: string,
  uuid: string,
  data: CompanyEligibilityRevocationCreate,
  config: AxiosRequestConfig = {},
) =>
  api.post<ApiResponse<'api_v1_companies_eligibility_requests_revoke_create'>>(
    `${company(companyUuid)}${uuid}/revoke/`,
    data,
    config,
  );

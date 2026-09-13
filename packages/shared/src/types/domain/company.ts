import type { ApiSchema, ApiRequest, ApiResponse } from '../contracts';

export type CompanyStatus = ApiSchema<'CompanyStatusEnum'>;

export type CompanyType = ApiSchema<'CompanyTypeEnum'>;

export type DocumentType = ApiSchema<'CompanyDocumentDocumentTypeEnum'>;

export type CompanyDocument = ApiResponse<'api_v1_companies_documents_retrieve'>;

export type CompanyUserProfile = ApiSchema<'_CompanyUserProfile'>;

export type Company = ApiResponse<'api_v1_companies_retrieve'>;

export type CompanyListItem = ApiResponse<'api_v1_companies_list'>['results'][number];

export type CompanyUpdateResponse = ApiResponse<'api_v1_companies_partial_update'>;

export type CompanyUpdate = ApiRequest<'api_v1_companies_partial_update'>;

export type CompanyStats = ApiResponse<'api_v1_companies_stats_retrieve'>;

export type CompanyRegistration = ApiRequest<'api_v1_companies_create'>;

export type CompanyRegistrationResponse = ApiResponse<'api_v1_companies_create'>;

export type ApplicationStatus = ApiResponse<'api_v1_companies_application_status_retrieve'>;

export type ApplicationResponse =
  | ApiResponse<'api_v1_companies_submit_create'>
  | ApiResponse<'api_v1_companies_resubmit_create'>
  | ApiResponse<'api_v1_companies_withdraw_create'>;

export type ApplicationResubmit = ApiRequest<'api_v1_companies_resubmit_create'>;

export type ApplicationWithdraw = ApiRequest<'api_v1_companies_withdraw_create'>;

export type DocumentUpload = ApiRequest<'api_v1_companies_documents_create'> &
  Required<Pick<ApiRequest<'api_v1_companies_documents_create'>, 'file'>>;

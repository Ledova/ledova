import type { ApiSchema, ApiRequest, ApiResponse } from '../contracts';

export type CompanyStatus = ApiSchema<'CompanyStatusEnum'>;

export type CompanyType = ApiSchema<'CompanyTypeEnum'>;

export type DocumentType = ApiSchema<'CompanyDocumentDocumentTypeEnum'>;

export type CompanyDocument = ApiSchema<'CompanyDocument'>;

export type Company = ApiResponse<'api_v1_companies_retrieve'>;

export type CompanyListItem = ApiResponse<'api_v1_companies_list'>['results'][number];

export type CompanyUpdateResponse = ApiResponse<'api_v1_companies_partial_update'>;

export type CompanyUpdate = ApiRequest<'api_v1_companies_partial_update'>;

export type CompanyRegistration = ApiRequest<'api_v1_companies_create'>;

export type CompanyRegistrationResponse = ApiResponse<'api_v1_companies_create'>;

export type CompanyActivation = ApiSchema<'CompanyActivation'>;

export type CompanyActivationAttempt = ApiSchema<'CompanyActivationAttempt'>;

export type CompanyActivate = ApiRequest<'api_v1_companies_activate_create'>;

export type CompanyActivated = ApiResponse<'api_v1_companies_activate_create'>;

export type DocumentUpload = ApiRequest<'api_v1_companies_documents_create'> &
  Required<Pick<ApiRequest<'api_v1_companies_documents_create'>, 'file'>>;

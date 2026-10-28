import type { ApiSchema, ApiRequest, ApiResponse, ApiQuery } from '../contracts';

export type TokenType = ApiSchema<'TokenTypeEnum'>;
export type CapitalIncreaseStatus = ApiSchema<'CapitalRequestStatusEnum'>;

export type CompanyShareToken = ApiResponse<'api_v1_tokens_retrieve'>;

export type TokenCreate = ApiRequest<'api_v1_tokens_create'>;

export type CompanyShareTokenListItem = ApiResponse<'api_v1_tokens_list'>['results'][number];

export type TokenHoldersResponse = ApiResponse<'api_v1_tokens_holders_retrieve'>;
export type CompanyOwnershipSummary = ApiResponse<'api_v1_tokens_ownership_retrieve'>;
export type ClassOwnershipHolders = ApiResponse<'api_v1_tokens_ownership_holders_list'>;
export type ClassOwnershipQuery = ApiQuery<'api_v1_tokens_ownership_holders_list'>;

export type FormerMember = ApiSchema<'FormerMember'>;

export type TokenIssuance = ApiResponse<'api_v1_tokens_issuances_list'>['results'][number];

export type CapitalIncreaseListItem = ApiResponse<'api_v1_tokens_capital_increases_list'>['results'][number];

export type ShareIssuanceRequest = ApiSchema<'ShareIssuanceRequest'>;

export type ShareIssuanceRequestQueryParams = ApiQuery<'api_v1_tokens_issuance_requests_list'>;

export type RegisterCertificatePreview = ApiResponse<'api_v1_tokens_register_certificate_retrieve'>;
export type RegisterCertificateRequest = ApiRequest<'api_v1_tokens_register_certificate_create'>;

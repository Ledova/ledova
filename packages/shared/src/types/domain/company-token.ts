import type { ApiSchema, ApiRequest, ApiResponse, ApiQuery } from '../contracts';

export type TokenType = ApiSchema<'TokenTypeEnum'>;

export type CompanyShareToken = ApiResponse<'api_v1_tokens_retrieve'>;

export type TokenCreate = ApiRequest<'api_v1_tokens_create'>;

export type CompanyShareTokenListItem = ApiResponse<'api_v1_tokens_list'>['results'][number];

export type TokenHoldersResponse = ApiResponse<'api_v1_tokens_holders_retrieve'>;
export type CompanyOwnershipSummary = ApiResponse<'api_v1_tokens_ownership_retrieve'>;
export type ClassOwnershipHolders = ApiResponse<'api_v1_tokens_ownership_holders_list'>;
export type ClassOwnershipQuery = ApiQuery<'api_v1_tokens_ownership_holders_list'>;

export type RegisterInspectionPreview = ApiResponse<'api_v1_tokens_register_inspection_copy_retrieve'>;
export type RegisterInspectionCopies = ApiResponse<'api_v1_tokens_register_inspection_copies_retrieve'>;
export type RegisterInspectionRequest = ApiRequest<'api_v1_tokens_register_inspection_copy_create'>;

export type RegisterCertificatePreview = ApiResponse<'api_v1_tokens_register_certificate_retrieve'>;
export type RegisterCertificateRequest = ApiRequest<'api_v1_tokens_register_certificate_create'>;

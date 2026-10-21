import type { ApiQuery, ApiRequest, ApiResponse, ApiSchema } from '../contracts';

export type ClassRightsRevision = ApiSchema<'ClassRightsRevision'>;
export type ClassRightsHistory = ApiResponse<'api_v1_tokens_class_rights_retrieve'>;
export type ClassRightsRequest = ApiRequest<'api_v1_tokens_class_rights_create'>;
export type ClassRightsQuery = ApiQuery<'api_v1_tokens_class_rights_retrieve'>;

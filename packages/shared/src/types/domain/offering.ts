import type { ApiSchema, ApiRequest, ApiResponse } from '../contracts';

export type DirectoryCompany = ApiSchema<'DirectoryCompany'>;

export type DirectoryOpenOffering = ApiSchema<'DirectoryOpenOfferingResponse'>;

export type DirectoryToken = ApiResponse<'api_v1_directory_tokens_retrieve'>;

export type Offering = ApiResponse<'api_v1_offerings_retrieve'>;

export type OfferingListItem = ApiResponse<'api_v1_offerings_list'>['results'][number];

export type OfferingInput = ApiRequest<'api_v1_offerings_create'>;

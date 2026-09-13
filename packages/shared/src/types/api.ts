import type { ApiSchema, ApiResponse } from './contracts';

export interface FormErrors {
  [key: string]: string[];
}

export type PaginatedResponse<T> = Omit<ApiSchema<'PaginatedAssetList'>, 'results'> & { results: T[] };

export interface UserFriendlyError extends Error {
  isUserFriendly: true;
  originalError?: unknown;
}

export type AccountExportData = ApiResponse<'api_user_profiles_export_data_retrieve'>;

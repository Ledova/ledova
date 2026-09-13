import type { ApiRequest, ApiResponse } from '../contracts';

export type FinancialProfile = ApiResponse<'api_financial_profiles_retrieve'>;

export type CreateFinancialProfile = ApiRequest<'api_financial_profiles_create'>;

export type UpdateFinancialProfile = ApiRequest<'api_financial_profiles_partial_update'>;

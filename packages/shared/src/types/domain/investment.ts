import type { ApiRequest, ApiSchema } from '../contracts';

export type FinancialProfile = ApiSchema<'FinancialProfile'>;

export type CreateFinancialProfile = ApiRequest<'api_financial_profiles_create'>;

export type UpdateFinancialProfile = ApiRequest<'api_financial_profiles_partial_update'>;

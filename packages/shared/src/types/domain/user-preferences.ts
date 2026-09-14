import type { ApiSchema, ApiRequest, ApiResponse } from '../contracts';
export type AccountRole = ApiSchema<'RoleEnum'>;

export type UserAccount = ApiResponse<'api_user_accounts_list'>;

export type AccountSummary = ApiSchema<'AccountSummary'>;

export type SelectedPortfolio = NonNullable<UserPreferences['selectedPortfolio']>;

export type Theme = ApiSchema<'ThemeEnum'>;
export type DisplayCurrency = ApiSchema<'DisplayCurrencyEnum'>;

export type UserPreferences = ApiResponse<'api_user_preferences_list'>;

export type UpdateUserPreferences = ApiRequest<'api_user_preferences_create'>;

import type { ApiSchema, ApiResponse } from '../contracts';
export type AccountRole = ApiSchema<'RoleEnum'>;

export type UserAccount = ApiResponse<'api_user_accounts_list'>;

export type UserPreferences = ApiResponse<'api_user_preferences_list'>;

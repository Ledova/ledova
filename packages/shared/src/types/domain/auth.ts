import type { ApiRequest, ApiResponse } from '../contracts';
export type SigninRequest = ApiRequest<'api_signin_create'>;

export type SignupRequest = ApiRequest<'api_signup_create'>;

export type EmailVerificationRequest = ApiRequest<'api_email_verification_create'>;

export type ResendVerificationRequest = ApiRequest<'api_resend_verification_create'>;

export type TokenRefreshRequest = ApiRequest<'api_token_refresh_create'>;

export type TokenRefreshResult = ApiResponse<'api_token_refresh_create'>;

export type AuthVerificationResponse = ApiResponse<'api_auth_verify_retrieve'>;

export type ChangePasswordRequest = ApiRequest<'api_change_password_create'>;

export type ChangePasswordResponse = ApiResponse<'api_change_password_create'>;

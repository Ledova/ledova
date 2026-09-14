import type { ApiRequest, ApiResponse } from '../contracts';
export type RequestVerificationChallengeResponse = ApiResponse<'api_wallets_request_verification_create'>;

export type VerifyWalletRequest = ApiRequest<'api_wallets_verify_signature_create'>;

export type VerifyWalletResponse = ApiResponse<'api_wallets_verify_signature_create'>;

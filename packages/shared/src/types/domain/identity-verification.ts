import type { ApiSchema, ApiResponse } from '../contracts';
export type KYCProvider = ApiSchema<'KycProviderEnum'>;

export type VerificationStatus = ApiSchema<'UserProfile'>['verificationStatus'];

export type ReviewAnswer = ApiSchema<'UserProfile'>['reviewResult'];

export type IdentityVerificationToken = ApiResponse<'api_users_identity_verification_token_create'>;

export type ExtractedApplicantData = ApiSchema<'ExtractedApplicantData'>;

export type IdentityVerificationStatus = ApiResponse<'api_users_identity_verification_status_retrieve'>;

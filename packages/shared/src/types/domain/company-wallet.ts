import type { ApiQuery, ApiRequest, ApiResponse } from '../contracts';

export type WalletNomination = ApiResponse<'api_v1_whitelist_wallet_nominations_retrieve'>;
export type WalletNominationPreview = ApiResponse<'api_v1_whitelist_wallet_nominations_preview_create'>;
export type WalletNominationPreviewRequest = ApiRequest<'api_v1_whitelist_wallet_nominations_preview_create'>;
export type WalletNominationRequest = ApiRequest<'api_v1_whitelist_wallet_nominations_create'>;
export type WalletNominationQuery = ApiQuery<'api_v1_whitelist_wallet_nominations_list'>;
export type CompanyWalletNomination = ApiResponse<'api_v1_whitelist_company_wallet_nominations_retrieve'>;
export type CompanyWalletNominationQuery = ApiQuery<'api_v1_whitelist_company_wallet_nominations_list'>;
export type CompanyWalletInstruction = ApiResponse<'api_v1_whitelist_company_wallet_instructions_retrieve'>;
export type CompanyWalletPreparation = ApiRequest<'api_v1_whitelist_company_wallet_instructions_create'>;
export type CompanyWalletDecisionPreview =
  ApiResponse<'api_v1_whitelist_company_wallet_instructions_decision_preview_create'>;
export type CompanyWalletDecisionRequest =
  ApiRequest<'api_v1_whitelist_company_wallet_instructions_decision_preview_create'>;
export type CompanyWalletDecideRequest = ApiRequest<'api_v1_whitelist_company_wallet_instructions_decide_create'>;
export type CompanyWalletInstructionQuery = ApiQuery<'api_v1_whitelist_company_wallet_instructions_list'>;
export type CompanyWalletTarget = ApiResponse<'api_v1_whitelist_company_wallet_targets_retrieve'>;
export type CompanyWalletTargetQuery = ApiQuery<'api_v1_whitelist_company_wallet_targets_list'>;

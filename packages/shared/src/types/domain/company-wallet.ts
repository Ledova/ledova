import type { ApiQuery, ApiRequest, ApiResponse } from '../contracts';

export type CompanyWalletNomination = ApiResponse<'api_v1_whitelist_company_wallet_nominations_retrieve'>;
export type CompanyWalletNominationQuery = ApiQuery<'api_v1_whitelist_company_wallet_nominations_list'>;
export type CompanyWalletInstruction = ApiResponse<'api_v1_whitelist_company_wallet_instructions_retrieve'>;
export type CompanyWalletDecisionRequest =
  ApiRequest<'api_v1_whitelist_company_wallet_instructions_decision_preview_create'>;
export type CompanyWalletDecideRequest = ApiRequest<'api_v1_whitelist_company_wallet_instructions_decide_create'>;
export type CompanyWalletInstructionQuery = ApiQuery<'api_v1_whitelist_company_wallet_instructions_list'>;

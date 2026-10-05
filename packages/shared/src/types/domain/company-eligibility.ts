import type { ApiRequest, ApiResponse } from '../contracts';

export type CompanyEligibilityRequest = ApiResponse<'api_v1_company_eligibility_requests_retrieve'>;
export type CompanyEligibilitySharedSummary = CompanyEligibilityRequest['sharedSummary'];
export type CompanyEligibilityRequestPreview = ApiRequest<'api_v1_company_eligibility_requests_preview_create'>;
export type CompanyEligibilityRequestPreviewResult = ApiResponse<'api_v1_company_eligibility_requests_preview_create'>;
export type CompanyEligibilityRequestCreate = ApiRequest<'api_v1_company_eligibility_requests_create'>;
export type CompanyEligibilityDecisionPreview =
  ApiRequest<'api_v1_companies_eligibility_requests_decision_preview_create'>;
export type CompanyEligibilityDecisionPreviewResult =
  ApiResponse<'api_v1_companies_eligibility_requests_decision_preview_create'>;
export type CompanyEligibilityDecisionCreate = ApiRequest<'api_v1_companies_eligibility_requests_decide_create'>;
export type CompanyEligibilityWithdrawalCreate = ApiRequest<'api_v1_company_eligibility_requests_withdraw_create'>;
export type CompanyEligibilityRevocationCreate = ApiRequest<'api_v1_companies_eligibility_requests_revoke_create'>;

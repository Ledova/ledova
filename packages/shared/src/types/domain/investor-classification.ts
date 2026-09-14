import type { ApiSchema, ApiRequest, ApiResponse } from '../contracts';

export type InvestorCategory = ApiSchema<'CategoryEnum'>;

export type InvestorClassificationStatus = ApiSchema<'InvestorClassificationStatusEnum'>;

export type CertifierBody = ApiSchema<'CertifierBodyEnum'>;

export type InvestorEligibilityReason = InvestorEligibility['reasons'][number];

export type InvestorClassification = ApiResponse<'api_investor_classifications_retrieve'>;

export type InvestorEligibility = ApiResponse<'api_investor_classifications_eligibility_retrieve'>;

export type InvestorClassificationSubmission = Omit<
  ApiRequest<'api_investor_classifications_create'>,
  'evidenceFile' | 'declarationAccepted'
> & { file: File };

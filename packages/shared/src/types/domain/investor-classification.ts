import type { ApiSchema, ApiRequest, ApiResponse } from '../contracts';

export type InvestorCategory = ApiSchema<'CategoryEnum'>;

export type CertifierBody = ApiSchema<'CertifierBodyEnum'>;

export type InvestorReadinessReason = InvestorReadiness['reasons'][number];

export type InvestorClassification = ApiSchema<'InvestorClassification'>;

export type InvestorReadiness = ApiResponse<'api_investor_classifications_eligibility_retrieve'>;

export type InvestorClassificationSubmission = Omit<
  ApiRequest<'api_investor_classifications_create'>,
  'evidenceFile' | 'declarationAccepted'
> & { file: File };

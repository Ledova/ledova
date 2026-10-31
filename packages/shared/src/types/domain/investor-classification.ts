import type { ApiSchema, ApiRequest } from '../contracts';

export type InvestorCategory = ApiSchema<'CategoryEnum'>;

export type CertifierBody = ApiSchema<'CertifierBodyEnum'>;

export type InvestorClassification = ApiSchema<'InvestorClassification'>;

export type UploadFile = Blob | { uri: string; name: string; type: string };

export type InvestorClassificationSubmission = Omit<
  ApiRequest<'api_investor_classifications_create'>,
  'evidenceFile' | 'declarationAccepted'
> & { file: UploadFile };

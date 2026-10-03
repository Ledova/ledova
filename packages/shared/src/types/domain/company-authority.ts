import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type CompanyAuthorityRequest = ApiSchema<'CompanyAuthorityRequest'>;

export type CompanyAuthorityAdmission = ApiRequest<'api_v1_company_authority_requests_admit_create'>;

export type CompanyCapability = ApiSchema<'CompanyCapabilityEnum'>;

export type CompanyAuthoritySubmission = ApiRequest<'api_v1_company_authority_requests_create'> &
  Required<
    Pick<ApiRequest<'api_v1_company_authority_requests_create'>, 'requestedCapabilities' | 'delegatableCapabilities'>
  >;

export type CompanyAuthorityQueryParams = ApiQuery<'api_v1_company_authority_requests_list'>;

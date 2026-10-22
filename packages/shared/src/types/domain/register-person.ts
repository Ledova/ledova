import type { ApiRequest, ApiResponse } from '../contracts';

export type RegisterPersonRegistrationRequest = ApiRequest<'api_v1_tokens_register_people_create'>;
export type RegisterPersonRegistrationRecord = ApiResponse<'api_v1_tokens_register_people_create'>;
export type CompanyPeople = ApiResponse<'api_v1_tokens_register_people_list'>;

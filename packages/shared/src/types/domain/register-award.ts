import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterAward = ApiSchema<'RegisterAward'>;
export type RegisterAwardPreparation = ApiRequest<'api_v1_tokens_register_awards_create'>;
export type RegisterAwardQueryParams = ApiQuery<'api_v1_tokens_register_awards_list'>;
export type RegisterAwardVesting = ApiSchema<'RegisterAwardVesting'>;
export type RegisterAwardVestingPreparation = ApiRequest<'api_v1_tokens_register_award_vestings_create'>;
export type RegisterAwardVestingQueryParams = ApiQuery<'api_v1_tokens_register_award_vestings_list'>;

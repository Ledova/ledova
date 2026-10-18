import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterAward = ApiSchema<'RegisterAward'>;
export type RegisterAwardPreparation = ApiRequest<'api_v1_tokens_register_awards_create'>;
export type RegisterAwardQueryParams = ApiQuery<'api_v1_tokens_register_awards_list'>;
export type RegisterAwardVesting = ApiSchema<'RegisterAwardVesting'>;
export type RegisterAwardVestingPreparation = ApiRequest<'api_v1_tokens_register_award_vestings_create'>;
export type RegisterAwardVestingQueryParams = ApiQuery<'api_v1_tokens_register_award_vestings_list'>;
export type RegisterAwardEnd = ApiSchema<'RegisterAwardEnd'>;
export type RegisterAwardEndPreparation = ApiRequest<'api_v1_tokens_register_award_ends_create'>;
export type RegisterAwardEndQueryParams = ApiQuery<'api_v1_tokens_register_award_ends_list'>;
export type RegisterAwardVestingReversal = ApiSchema<'RegisterAwardVestingReversal'>;
export type RegisterAwardVestingReversalPreparation =
  ApiRequest<'api_v1_tokens_register_award_vesting_reversals_create'>;
export type RegisterAwardVestingReversalQueryParams = ApiQuery<'api_v1_tokens_register_award_vesting_reversals_list'>;

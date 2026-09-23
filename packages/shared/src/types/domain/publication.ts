import type { ApiResponse } from '../contracts';

export type Publication = ApiResponse<'api_v1_publications_list'>['results'][number];

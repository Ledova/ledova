import type { ApiRequest, ApiResponse, ApiSchema } from '../contracts';

export type Publication = ApiResponse<'api_v1_publications_list'>['results'][number];

export type PublicationBallot = ApiSchema<'PublicationBallot'>;

export type PublicationCount = ApiSchema<'PublicationCount'>;

export type PublicationResult = ApiSchema<'PublicationResult'>;

export type PublicationPaymentRecord = ApiSchema<'PublicationPaymentRecord'>;

export type CastBallotRequest = ApiRequest<'api_v1_publications_ballot_create'>;

export type ResolutionStatus = 'upcoming' | 'open' | 'closed';

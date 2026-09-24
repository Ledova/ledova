import { AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { PUBLICATION_ENDPOINTS, type BallotChoice } from '../constants';
import type {
  CastBallotRequest,
  PaginatedResponse,
  Publication,
  PublicationFilters,
  PublicationQueryParams,
  PublicationSummary,
} from '../types';
import { getNextPageParam } from '../utils';

export const getPublications = (apiClient: AxiosInstance, page = 1, filters: PublicationFilters = {}) =>
  apiClient.get<PaginatedResponse<Publication>>(PUBLICATION_ENDPOINTS.BASE, {
    params: { page, ...filters } satisfies PublicationQueryParams,
  });

export const getPublicationSummary = (apiClient: AxiosInstance) =>
  apiClient.get<PublicationSummary>(PUBLICATION_ENDPOINTS.SUMMARY);

export const getPublicationsNextPage = (lastPage: AxiosResponse<PaginatedResponse<Publication>>): number | undefined =>
  getNextPageParam(lastPage.data);

export const openPublication = (apiClient: AxiosInstance, uuid: string) =>
  apiClient.get<Blob>(PUBLICATION_ENDPOINTS.FILE(uuid), { responseType: 'blob' });

export const downloadPublication = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<ArrayBuffer>(PUBLICATION_ENDPOINTS.FILE(uuid), { ...config, responseType: 'arraybuffer' });

export const castBallot = (
  apiClient: AxiosInstance,
  uuid: string,
  choice: BallotChoice,
  config: AxiosRequestConfig = {},
) => apiClient.post<Publication>(PUBLICATION_ENDPOINTS.BALLOT(uuid), { choice } satisfies CastBallotRequest, config);

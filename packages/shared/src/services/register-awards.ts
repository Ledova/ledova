import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type {
  PaginatedResponse,
  RegisterAward,
  RegisterAwardPreparation,
  RegisterAwardQueryParams,
  RegisterAwardVesting,
  RegisterAwardVestingPreparation,
  RegisterAwardVestingQueryParams,
  RegisterAwardEnd,
  RegisterAwardEndPreparation,
  RegisterAwardEndQueryParams,
  RegisterAwardVestingReversal,
  RegisterAwardVestingReversalPreparation,
  RegisterAwardVestingReversalQueryParams,
} from '../types';

export const getRegisterAwards = (
  apiClient: AxiosInstance,
  params: RegisterAwardQueryParams = {},
  config: AxiosRequestConfig = {},
) => apiClient.get<PaginatedResponse<RegisterAward>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARDS, { ...config, params });

export const getRegisterAward = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<RegisterAward>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD(uuid), config);

export const recordRegisterAward = (
  apiClient: AxiosInstance,
  data: RegisterAwardPreparation,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterAward>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARDS, data, config);

export const getRegisterAwardVestings = (
  apiClient: AxiosInstance,
  params: RegisterAwardVestingQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<PaginatedResponse<RegisterAwardVesting>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_VESTINGS, {
    ...config,
    params,
  });

export const recordRegisterAwardVesting = (
  apiClient: AxiosInstance,
  data: RegisterAwardVestingPreparation,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterAwardVesting>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_VESTINGS, data, config);

export const getRegisterAwardVesting = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<RegisterAwardVesting>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_VESTING(uuid), config);

export const downloadRegisterAwardFile = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_FILE(uuid), { ...config, responseType: 'blob' });

export const downloadRegisterAwardVestingFile = (
  apiClient: AxiosInstance,
  uuid: string,
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_VESTING_FILE(uuid), { ...config, responseType: 'blob' });

export const getRegisterAwardEnds = (
  apiClient: AxiosInstance,
  params: RegisterAwardEndQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<PaginatedResponse<RegisterAwardEnd>>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_ENDS, {
    ...config,
    params,
  });

export const getRegisterAwardEnd = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<RegisterAwardEnd>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_END(uuid), config);

export const recordRegisterAwardEnd = (
  apiClient: AxiosInstance,
  data: RegisterAwardEndPreparation,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterAwardEnd>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_ENDS, data, config);

export const downloadRegisterAwardEndFile = (apiClient: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_END_FILE(uuid), { ...config, responseType: 'blob' });

export const getRegisterAwardVestingReversals = (
  apiClient: AxiosInstance,
  params: RegisterAwardVestingReversalQueryParams = {},
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<PaginatedResponse<RegisterAwardVestingReversal>>(
    COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_VESTING_REVERSALS,
    { ...config, params },
  );

export const getRegisterAwardVestingReversal = (
  apiClient: AxiosInstance,
  uuid: string,
  config: AxiosRequestConfig = {},
) => apiClient.get<RegisterAwardVestingReversal>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_VESTING_REVERSAL(uuid), config);

export const recordRegisterAwardVestingReversal = (
  apiClient: AxiosInstance,
  data: RegisterAwardVestingReversalPreparation,
  config: AxiosRequestConfig = {},
) =>
  apiClient.post<RegisterAwardVestingReversal>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_VESTING_REVERSALS, data, config);

export const downloadRegisterAwardVestingReversalFile = (
  apiClient: AxiosInstance,
  uuid: string,
  config: AxiosRequestConfig = {},
) =>
  apiClient.get<Blob>(COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARD_VESTING_REVERSAL_FILE(uuid), {
    ...config,
    responseType: 'blob',
  });

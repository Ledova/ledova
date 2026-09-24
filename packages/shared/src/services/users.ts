import { AxiosInstance, type AxiosRequestConfig } from 'axios';
import { USER_PROFILE_ENDPOINTS } from '../constants';
import type {
  ApiResponse,
  UserProfile,
  UpdateUserProfile,
  CompleteUserProfile,
  PaginatedResponse,
  AccountExportData,
} from '../types';

export const updateUserProfile = (apiClient: AxiosInstance, uuid: string, data: UpdateUserProfile) =>
  apiClient.patch<UserProfile>(USER_PROFILE_ENDPOINTS.DETAIL(uuid), data);

export const updateUserProfileCompletion = (apiClient: AxiosInstance, uuid: string, data: CompleteUserProfile) =>
  apiClient.patch<UserProfile>(USER_PROFILE_ENDPOINTS.DETAIL(uuid), data);

export const getUserProfiles = (apiClient: AxiosInstance) =>
  apiClient.get<PaginatedResponse<UserProfile>>(USER_PROFILE_ENDPOINTS.BASE);

export const deleteAccount = (apiClient: AxiosInstance) =>
  apiClient.post<ApiResponse<'api_user_profiles_delete_account_create'>>(USER_PROFILE_ENDPOINTS.DELETE_ACCOUNT);

export const exportAccountData = (apiClient: AxiosInstance, config: AxiosRequestConfig = {}) =>
  apiClient.get<AccountExportData>(USER_PROFILE_ENDPOINTS.EXPORT_DATA, config);

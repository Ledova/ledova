import { AxiosInstance } from 'axios';
import { USER_PREFERENCES_ENDPOINTS } from '../constants';
import type { UserPreferences } from '../types';

export const getCurrentUserPreferences = (apiClient: AxiosInstance) => {
  return apiClient.get<UserPreferences>(USER_PREFERENCES_ENDPOINTS.BASE);
};

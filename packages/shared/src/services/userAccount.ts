import { AxiosInstance } from 'axios';

import { USER_ACCOUNT_ENDPOINTS } from '../constants';
import type { AccountRole, UserAccount } from '../types';

export const getUserAccount = (apiClient: AxiosInstance) => apiClient.get<UserAccount>(USER_ACCOUNT_ENDPOINTS.BASE);

export const setAccountRole = (apiClient: AxiosInstance, uuid: string, role: AccountRole) =>
  apiClient.patch<UserAccount>(USER_ACCOUNT_ENDPOINTS.DETAIL(uuid), { role });

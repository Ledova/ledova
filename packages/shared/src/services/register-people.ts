import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { COMPANY_TOKEN_ENDPOINTS } from '../constants/api';
import type { CompanyPeople, RegisterPersonRegistrationRecord, RegisterPersonRegistrationRequest } from '../types';
import { isRegisterImportMembers } from '../utils/register-imports';

export const getCompanyPeople = (apiClient: AxiosInstance, company: string, config: AxiosRequestConfig = {}) =>
  apiClient
    .get<CompanyPeople>(COMPANY_TOKEN_ENDPOINTS.REGISTER_PEOPLE, { ...config, params: { company } })
    .then((response) => {
      if (response.data.company !== company || !isRegisterImportMembers({ ...response.data, awardRecipients: [] }))
        throw new Error('The company people could not be confirmed.');
      return response;
    });

export const registerCompanyPerson = (
  apiClient: AxiosInstance,
  request: RegisterPersonRegistrationRequest,
  config: AxiosRequestConfig = {},
) => apiClient.post<RegisterPersonRegistrationRecord>(COMPANY_TOKEN_ENDPOINTS.REGISTER_PEOPLE, request, config);

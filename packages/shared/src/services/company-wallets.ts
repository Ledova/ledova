import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import type {
  PaginatedResponse,
  CompanyWalletNomination,
  CompanyWalletNominationQuery,
  CompanyWalletInstruction,
  CompanyWalletInstructionQuery,
} from '../types';

const nominated = '/api/v1/whitelist/company-wallet-nominations/';
const instructions = '/api/v1/whitelist/company-wallet-instructions/';

export const getCompanyWalletNominations = (
  api: AxiosInstance,
  params: CompanyWalletNominationQuery,
  config: AxiosRequestConfig = {},
) => api.get<PaginatedResponse<CompanyWalletNomination>>(nominated, { ...config, params });
export const getCompanyWalletInstructions = (
  api: AxiosInstance,
  params: CompanyWalletInstructionQuery,
  config: AxiosRequestConfig = {},
) => api.get<PaginatedResponse<CompanyWalletInstruction>>(instructions, { ...config, params });

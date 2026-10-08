import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import type {
  PaginatedResponse,
  WalletNomination,
  WalletNominationPreview,
  WalletNominationPreviewRequest,
  WalletNominationRequest,
  WalletNominationQuery,
  CompanyWalletNomination,
  CompanyWalletNominationQuery,
  CompanyWalletInstruction,
  CompanyWalletPreparation,
  CompanyWalletDecisionPreview,
  CompanyWalletDecisionRequest,
  CompanyWalletDecideRequest,
  CompanyWalletInstructionQuery,
  CompanyWalletTarget,
  CompanyWalletTargetQuery,
} from '../types';

const own = '/api/v1/whitelist/wallet-nominations/';
const nominated = '/api/v1/whitelist/company-wallet-nominations/';
const instructions = '/api/v1/whitelist/company-wallet-instructions/';
const targets = '/api/v1/whitelist/company-wallet-targets/';

export const getWalletNominations = (
  api: AxiosInstance,
  params: WalletNominationQuery,
  config: AxiosRequestConfig = {},
) => api.get<PaginatedResponse<WalletNomination>>(own, { ...config, params });
export const getWalletNomination = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<WalletNomination>(`${own}${uuid}/`, config);
export const previewWalletNomination = (
  api: AxiosInstance,
  data: WalletNominationPreviewRequest,
  config: AxiosRequestConfig = {},
) => api.post<WalletNominationPreview>(`${own}preview/`, data, config);
export const createWalletNomination = (
  api: AxiosInstance,
  data: WalletNominationRequest,
  config: AxiosRequestConfig = {},
) => api.post<WalletNomination>(own, data, config);
export const getCompanyWalletNominations = (
  api: AxiosInstance,
  params: CompanyWalletNominationQuery,
  config: AxiosRequestConfig = {},
) => api.get<PaginatedResponse<CompanyWalletNomination>>(nominated, { ...config, params });
export const getCompanyWalletNomination = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<CompanyWalletNomination>(`${nominated}${uuid}/`, config);
export const getCompanyWalletInstructions = (
  api: AxiosInstance,
  params: CompanyWalletInstructionQuery,
  config: AxiosRequestConfig = {},
) => api.get<PaginatedResponse<CompanyWalletInstruction>>(instructions, { ...config, params });
export const getCompanyWalletInstruction = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<CompanyWalletInstruction>(`${instructions}${uuid}/`, config);
export const prepareCompanyWalletInstruction = (
  api: AxiosInstance,
  data: CompanyWalletPreparation,
  config: AxiosRequestConfig = {},
) => api.post<CompanyWalletInstruction>(instructions, data, config);
export const previewCompanyWalletDecision = (
  api: AxiosInstance,
  uuid: string,
  data: CompanyWalletDecisionRequest,
  config: AxiosRequestConfig = {},
) => api.post<CompanyWalletDecisionPreview>(`${instructions}${uuid}/decision-preview/`, data, config);
export const decideCompanyWalletInstruction = (
  api: AxiosInstance,
  uuid: string,
  data: CompanyWalletDecideRequest,
  config: AxiosRequestConfig = {},
) => api.post<CompanyWalletInstruction>(`${instructions}${uuid}/decide/`, data, config);
export const getCompanyWalletTargets = (
  api: AxiosInstance,
  params: CompanyWalletTargetQuery,
  config: AxiosRequestConfig = {},
) => api.get<PaginatedResponse<CompanyWalletTarget>>(targets, { ...config, params });
export const getCompanyWalletTarget = (api: AxiosInstance, uuid: string, config: AxiosRequestConfig = {}) =>
  api.get<CompanyWalletTarget>(`${targets}${uuid}/`, config);

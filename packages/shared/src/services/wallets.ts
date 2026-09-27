import { WALLET_ENDPOINTS } from '../constants';
import { AxiosInstance, type AxiosRequestConfig } from 'axios';
import type { Wallet, CreateWallet, WalletQueryParams, PaginatedResponse } from '../types';

export const getWallets = (apiClient: AxiosInstance, params?: WalletQueryParams, config?: AxiosRequestConfig) =>
  apiClient.get<PaginatedResponse<Wallet>>(WALLET_ENDPOINTS.BASE, { ...config, params });

export const createWallet = (apiClient: AxiosInstance, data: CreateWallet, config?: AxiosRequestConfig) =>
  config
    ? apiClient.post<Wallet>(WALLET_ENDPOINTS.BASE, data, config)
    : apiClient.post<Wallet>(WALLET_ENDPOINTS.BASE, data);

export const updateWallet = (
  apiClient: AxiosInstance,
  uuid: string,
  data: Partial<Pick<Wallet, 'name'>>,
  config?: AxiosRequestConfig,
) =>
  config
    ? apiClient.patch<Wallet>(WALLET_ENDPOINTS.DETAIL(uuid), data, config)
    : apiClient.patch<Wallet>(WALLET_ENDPOINTS.DETAIL(uuid), data);

export const deleteWallet = (apiClient: AxiosInstance, uuid: string, config?: AxiosRequestConfig) =>
  config ? apiClient.delete(WALLET_ENDPOINTS.DETAIL(uuid), config) : apiClient.delete(WALLET_ENDPOINTS.DETAIL(uuid));

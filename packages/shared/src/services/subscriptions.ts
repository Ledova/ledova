import { AxiosInstance, AxiosRequestConfig } from 'axios';
import { SUBSCRIPTION_ENDPOINTS } from '../constants';
import type { PaginatedResponse, Subscription, SubscriptionDetail, SubscriptionInput } from '../types';

export const getSubscriptions = (apiClient: AxiosInstance, page?: number) =>
  page === undefined
    ? apiClient.get<PaginatedResponse<Subscription>>(SUBSCRIPTION_ENDPOINTS.BASE)
    : apiClient.get<PaginatedResponse<Subscription>>(SUBSCRIPTION_ENDPOINTS.BASE, { params: { page } });

export const getSubscription = (apiClient: AxiosInstance, uuid: string) =>
  apiClient.get<SubscriptionDetail>(SUBSCRIPTION_ENDPOINTS.DETAIL(uuid));

export const createSubscription = (apiClient: AxiosInstance, data: SubscriptionInput, config?: AxiosRequestConfig) =>
  config === undefined
    ? apiClient.post<SubscriptionDetail>(SUBSCRIPTION_ENDPOINTS.BASE, data)
    : apiClient.post<SubscriptionDetail>(SUBSCRIPTION_ENDPOINTS.BASE, data, config);

export const submitSubscription = (apiClient: AxiosInstance, uuid: string, config?: AxiosRequestConfig) =>
  config === undefined
    ? apiClient.post<SubscriptionDetail>(SUBSCRIPTION_ENDPOINTS.SUBMIT(uuid), {})
    : apiClient.post<SubscriptionDetail>(SUBSCRIPTION_ENDPOINTS.SUBMIT(uuid), {}, config);

export const withdrawSubscription = (
  apiClient: AxiosInstance,
  uuid: string,
  reason: string,
  config?: AxiosRequestConfig,
) =>
  config === undefined
    ? apiClient.post<SubscriptionDetail>(SUBSCRIPTION_ENDPOINTS.WITHDRAW(uuid), { reason })
    : apiClient.post<SubscriptionDetail>(SUBSCRIPTION_ENDPOINTS.WITHDRAW(uuid), { reason }, config);

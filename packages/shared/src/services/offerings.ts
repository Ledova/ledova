import { AxiosInstance, AxiosRequestConfig } from 'axios';
import { OFFERING_ENDPOINTS } from '../constants';
import type { IssuerSubscription, Offering, OfferingListItem, OfferingInput, PaginatedResponse } from '../types';

export const getOfferings = (apiClient: AxiosInstance, page?: number) =>
  page === undefined
    ? apiClient.get<PaginatedResponse<OfferingListItem>>(OFFERING_ENDPOINTS.BASE)
    : apiClient.get<PaginatedResponse<OfferingListItem>>(OFFERING_ENDPOINTS.BASE, { params: { page } });

export const getOffering = (apiClient: AxiosInstance, uuid: string) =>
  apiClient.get<Offering>(OFFERING_ENDPOINTS.DETAIL(uuid));

export const createOffering = (apiClient: AxiosInstance, data: OfferingInput, config?: AxiosRequestConfig) =>
  config === undefined
    ? apiClient.post<Offering>(OFFERING_ENDPOINTS.BASE, data)
    : apiClient.post<Offering>(OFFERING_ENDPOINTS.BASE, data, config);

export const updateOffering = (
  apiClient: AxiosInstance,
  uuid: string,
  data: Partial<OfferingInput>,
  config?: AxiosRequestConfig,
) =>
  config === undefined
    ? apiClient.patch<Offering>(OFFERING_ENDPOINTS.DETAIL(uuid), data)
    : apiClient.patch<Offering>(OFFERING_ENDPOINTS.DETAIL(uuid), data, config);

export const deleteOffering = (apiClient: AxiosInstance, uuid: string, config?: AxiosRequestConfig) =>
  config === undefined
    ? apiClient.delete(OFFERING_ENDPOINTS.DETAIL(uuid))
    : apiClient.delete(OFFERING_ENDPOINTS.DETAIL(uuid), config);

export const submitOffering = (apiClient: AxiosInstance, uuid: string, config?: AxiosRequestConfig) =>
  config === undefined
    ? apiClient.post<Offering>(OFFERING_ENDPOINTS.SUBMIT(uuid), {})
    : apiClient.post<Offering>(OFFERING_ENDPOINTS.SUBMIT(uuid), {}, config);

export const getOfferingSubscriptions = (apiClient: AxiosInstance, uuid: string, page?: number) =>
  page === undefined
    ? apiClient.get<PaginatedResponse<IssuerSubscription>>(OFFERING_ENDPOINTS.SUBSCRIPTIONS(uuid))
    : apiClient.get<PaginatedResponse<IssuerSubscription>>(OFFERING_ENDPOINTS.SUBSCRIPTIONS(uuid), {
        params: { page },
      });

export const withdrawOffering = (
  apiClient: AxiosInstance,
  uuid: string,
  reason: string,
  config?: AxiosRequestConfig,
) =>
  config === undefined
    ? apiClient.post<Offering>(OFFERING_ENDPOINTS.WITHDRAW(uuid), { reason })
    : apiClient.post<Offering>(OFFERING_ENDPOINTS.WITHDRAW(uuid), { reason }, config);

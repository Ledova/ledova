import { AxiosInstance } from 'axios';
import type { Asset, AssetQueryParams, PaginatedResponse } from '../types';
import { ASSET_ENDPOINTS } from '../constants';

export const getAssets = (apiClient: AxiosInstance, params?: AssetQueryParams) =>
  apiClient.get<PaginatedResponse<Asset>>(ASSET_ENDPOINTS.BASE, { params });

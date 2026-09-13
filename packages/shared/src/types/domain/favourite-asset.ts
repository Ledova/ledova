import type { BaseQueryParams } from '../api';
import type { Asset } from './asset';

export interface FavouriteAsset {
  uuid: string;
  userAccount: string;
  asset: Asset;
  createdAt: string;
  updatedAt: string;
}

export type CreateFavouriteAsset = { asset: string };

export interface FavouriteAssetQueryParams extends BaseQueryParams {
  asset?: string;
}

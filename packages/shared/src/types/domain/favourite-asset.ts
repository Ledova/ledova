import type { ApiRequest, ApiResponse, ApiQuery } from '../contracts';

export type FavouriteAsset = ApiResponse<'api_favourite_assets_retrieve'>;

export type CreateFavouriteAsset = ApiRequest<'api_favourite_assets_create'>;

export type FavouriteAssetQueryParams = ApiQuery<'api_favourite_assets_list'>;

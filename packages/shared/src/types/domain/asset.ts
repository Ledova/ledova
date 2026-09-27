import type { ApiSchema, ApiResponse, ApiQuery } from '../contracts';

export type AssetChainDeployment = ApiSchema<'AssetChainDeployment'>;

export type Asset = ApiResponse<'api_assets_list'>['results'][number];

export type AssetQueryParams = ApiQuery<'api_assets_list'>;

export type ExchangeRate = ApiResponse<'api_assets_exchange_rates_retrieve'>;

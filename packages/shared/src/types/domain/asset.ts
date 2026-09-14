import type { ApiSchema, ApiResponse, ApiQuery } from '../contracts';

export type ValueSource = ApiSchema<'ValueSourceEnum'>;

export type AssetChainDeployment = ApiSchema<'AssetChainDeployment'>;

export type Asset = ApiResponse<'api_assets_retrieve'>;

export type AssetQueryParams = ApiQuery<'api_assets_list'>;

export type AssetSnapshot = ApiResponse<'api_assets_snapshots_list'>[number];

export type AssetSnapshotQueryParams = ApiQuery<'api_assets_snapshots_list'>;

export type AssetFilters = Pick<AssetQueryParams, 'search' | 'asset_type' | 'chain'>;

export type ExchangeRate = ApiResponse<'api_assets_exchange_rates_retrieve'>;

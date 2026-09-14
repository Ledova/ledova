import type { ApiSchema, ApiResponse, ApiQuery } from '../contracts';

export type Portfolio = ApiResponse<'api_portfolios_retrieve'>;

export type PortfolioSnapshotReason = PortfolioSnapshot['snapshotReason'];

export type PortfolioSnapshotChain = ApiSchema<'PortfolioChainValue'>;

export type PortfolioSnapshotHolding = ApiSchema<'PortfolioHoldingValue'>;

export type PortfolioSnapshot = ApiResponse<'api_portfolios_snapshots_list'>[number];

export type PortfolioSnapshotQueryParams = ApiQuery<'api_portfolios_snapshots_list'>;

export interface PortfolioSnapshotDataPoint {
  dayIndex: number;
  date: string;
  totalMarketValue: number;
  assetValues: Record<string, number>;
  assetHoldings: Record<string, PortfolioSnapshotHolding>;
  assetSymbols: string[];
}

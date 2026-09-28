import type { ApiSchema, ApiResponse } from '../contracts';

export type OperatorSettlementAsset = ApiSchema<'SettlementAsset'>;

export type OperatorPaymentInstructions = ApiSchema<'OperatorPaymentInstructions'>;

export type Operator = ApiResponse<'api_operator_retrieve'>;

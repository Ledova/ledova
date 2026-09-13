import type { ApiSchema, ApiRequest, ApiResponse } from '../contracts';

export type OrderActionPurpose = OrderActionSnapshot['purpose'];
export type OrderActionDomain = ApiSchema<'SigningDomain'>;

export type OrderActionValues = ApiSchema<'OrderActionValues'>;

export type OrderActionCurrentValues = ApiSchema<'OrderActionCurrentValues'>;

export type OrderActionToken = ApiSchema<'OrderActionToken'>;

export type OrderActionContext = ApiResponse<'api_v1_trading_orders_action_context_retrieve'>;

export type OrderActionChallenge = ApiSchema<'OrderActionChallenge'>;

export type OrderActionChange = ApiSchema<'OrderActionChange'>;

export type OrderActionResult = ApiSchema<'OrderActionAppliedResult'>;

export type OrderActionSnapshot = ApiResponse<'api_v1_trading_orders_actions_retrieve'>;

export type OrderActionRequest = ApiRequest<'api_v1_trading_orders_cancel_message_create'>;

export type OrderActionModificationRequest = ApiRequest<'api_v1_trading_orders_modify_message_create'>;

export type OrderActionExecuteRequest = ApiRequest<'api_v1_trading_orders_cancel_create'>;

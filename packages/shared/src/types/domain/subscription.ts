import type { ApiQuery, ApiSchema, ApiRequest, ApiResponse } from '../contracts';

export type PaymentInstruction = NonNullable<ApiSchema<'SubscriptionDetail'>['paymentInstruction']>;

export type Subscription = ApiResponse<'api_v1_subscriptions_list'>['results'][number];

export type SubscriptionDetail = ApiResponse<'api_v1_subscriptions_retrieve'>;

export type IssuerSubscription = ApiResponse<'api_v1_offerings_subscriptions_list'>['results'][number];

export type IssuerSubscriptionQueryParams = ApiQuery<'api_v1_offerings_subscriptions_list'>;

export type SubscriptionInput = ApiRequest<'api_v1_subscriptions_create'>;

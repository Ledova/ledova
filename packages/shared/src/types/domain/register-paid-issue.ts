import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterPaidIssue = ApiSchema<'RegisterPaidIssue'>;
export type RegisterPaidIssueSource = ApiSchema<'RegisterPaidIssueSource'>;
export type RegisterPaidIssueSnapshot = ApiSchema<'RegisterPaidIssueSnapshot'>;
export type RegisterPaidIssueDecisionPreview = ApiSchema<'RegisterPaidIssueDecisionPreview'>;
export type RegisterPaidIssuePreparation = ApiRequest<'api_v1_tokens_register_paid_issues_create'>;
export type RegisterPaidIssueDecisionRequest = ApiRequest<'api_v1_tokens_register_paid_issues_decision_preview_create'>;
export type RegisterPaidIssueDecideRequest = ApiRequest<'api_v1_tokens_register_paid_issues_decide_create'>;
export type RegisterPaidIssueQuery = ApiQuery<'api_v1_tokens_register_paid_issues_list'>;
export type RegisterPaidIssueSourceQuery = ApiQuery<'api_v1_tokens_register_paid_issues_ready_subscriptions_list'>;

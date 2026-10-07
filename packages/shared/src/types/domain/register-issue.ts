import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterIssue = ApiSchema<'RegisterIssue'>;
export type RegisterIssueSnapshot = ApiSchema<'RegisterIssueSnapshot'>;
export type RegisterIssueDecisionPreview = ApiSchema<'RegisterIssueDecisionPreview'>;
export type RegisterIssuePreparation = ApiRequest<'api_v1_tokens_register_issues_create'>;
export type RegisterIssueDecisionRequest = ApiRequest<'api_v1_tokens_register_issues_decision_preview_create'>;
export type RegisterIssueDecideRequest = ApiRequest<'api_v1_tokens_register_issues_decide_create'>;
export type RegisterIssueQuery = ApiQuery<'api_v1_tokens_register_issues_list'>;

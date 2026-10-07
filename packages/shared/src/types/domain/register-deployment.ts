import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterDeployment = ApiSchema<'RegisterDeployment'>;
export type RegisterDeploymentSnapshot = ApiSchema<'RegisterDeploymentSnapshot'>;
export type RegisterDeploymentDecisionPreview = ApiSchema<'RegisterDeploymentDecisionPreview'>;
export type RegisterDeploymentPreparation = ApiRequest<'api_v1_tokens_register_deployments_create'>;
export type RegisterDeploymentDecisionRequest =
  ApiRequest<'api_v1_tokens_register_deployments_decision_preview_create'>;
export type RegisterDeploymentDecideRequest = ApiRequest<'api_v1_tokens_register_deployments_decide_create'>;
export type RegisterDeploymentQueryParams = ApiQuery<'api_v1_tokens_register_deployments_list'>;

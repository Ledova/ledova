import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';
import type { RegisterOpeningLink } from './register-opening';

export type RegisterLinkRecord = ApiSchema<'RegisterWalletLink'>;
export type RegisterLinkDecisionPreview = ApiSchema<'RegisterWalletLinkDecisionPreview'>;
export type RegisterLinkDecisionRequest = ApiRequest<'api_v1_tokens_register_links_decision_preview_create'>;
export type RegisterLinkDecideRequest = ApiRequest<'api_v1_tokens_register_links_decide_create'>;
export type RegisterLinkQueryParams = Pick<ApiQuery<'api_v1_tokens_register_links_list'>, 'company' | 'status'>;
export type RegisterWaitingWallets = ApiSchema<'RegisterWaitingWallets'>;
export type RegisterWalletProof = ApiSchema<'WalletProofEnum'>;

export type RegisterLinkPreparation = Omit<ApiRequest<'api_v1_tokens_register_links_create'>, 'mapping'> & {
  mapping: RegisterOpeningLink[];
};

export type RegisterLink = Omit<RegisterLinkRecord, 'mapping'> & {
  mapping: RegisterOpeningLink[];
};

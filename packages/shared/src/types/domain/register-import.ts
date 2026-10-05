import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterEvidence = ApiSchema<'RegisterEvidence'>;
export type RegisterEvidenceKind = ApiSchema<'RegisterEvidenceKindEnum'>;
export type RegisterEvidenceUpload = ApiRequest<'api_v1_tokens_register_evidence_create'>;
export type RegisterImportDecisionKind = ApiSchema<'RegisterImportDecisionKindEnum'>;
export type RegisterImportDecisionPreview = ApiSchema<'RegisterImportDecisionPreview'>;
export type RegisterImportDecisionRequest = ApiRequest<'api_v1_tokens_register_imports_decision_preview_create'>;
export type RegisterImportDecideRequest = ApiRequest<'api_v1_tokens_register_imports_decide_create'>;
export type RegisterImportQueryParams = ApiQuery<'api_v1_tokens_register_imports_list'>;

export type RegisterImportMemberRow = {
  member: string;
  name: string;
  residentialAddress: string;
  shares: string;
  enteredOn: string;
  amountPaid: string | null;
};

export type RegisterImportFormerRow = {
  name: string;
  residentialAddress: string;
  shares: string;
  ceasedOn: string;
};

export type RegisterImportPreparation = Omit<
  ApiRequest<'api_v1_tokens_register_imports_create'>,
  'members' | 'formerMembers'
> & {
  members: RegisterImportMemberRow[];
  formerMembers: RegisterImportFormerRow[];
};

export type RegisterImportRecord = ApiSchema<'RegisterImport'>;

export type RegisterImport = Omit<RegisterImportRecord, 'members' | 'formerMembers'> & {
  members: RegisterImportMemberRow[];
  formerMembers: RegisterImportFormerRow[];
};

import type { ApiQuery, ApiRequest, ApiSchema } from '../contracts';

export type RegisterImportDecisionPreview = ApiSchema<'RegisterImportDecisionPreview'>;
export type RegisterImportDecisionRequest = ApiRequest<'api_v1_tokens_register_imports_decision_preview_create'>;
export type RegisterImportDecideRequest = ApiRequest<'api_v1_tokens_register_imports_decide_create'>;
export type RegisterImportQueryParams = ApiQuery<'api_v1_tokens_register_imports_list'>;

export type RegisterImportAllotment = {
  allottedOn: string;
  shares: string;
  shareReference: string | null;
  certificateReference: string | null;
  amountPaid: string;
  amountUnpaid: string;
  fullyPaid: boolean;
  beneficiallyHeld: boolean;
};

export type RegisterImportMemberRow = {
  member: string;
  name: string;
  residentialAddress: string;
  shares: string;
  enteredOn: string;
  amountPaid: string | null;
  allotments?: RegisterImportAllotment[];
};

export type RegisterImportCurrentMemberRow = Omit<RegisterImportMemberRow, 'amountPaid' | 'allotments'> & {
  allotments: RegisterImportAllotment[];
};

export type RegisterImportFormerRow = {
  name: string;
  residentialAddress: string;
  shares: string;
  ceasedOn: string;
};

export type RegisterImportPreparation = Omit<
  ApiRequest<'api_v1_tokens_register_imports_create'>,
  'members' | 'formerMembers' | 'sourceConfirmed'
> & {
  sourceConfirmed: true;
  members: RegisterImportCurrentMemberRow[];
  formerMembers: RegisterImportFormerRow[];
};

export type RegisterImportRecord = ApiSchema<'RegisterImport'>;

export type RegisterImport = Omit<RegisterImportRecord, 'members' | 'formerMembers'> & {
  members: RegisterImportMemberRow[];
  formerMembers: RegisterImportFormerRow[];
};

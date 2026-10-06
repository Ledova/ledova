import type { ApiRequest, ApiSchema } from '../contracts';
import type {
  RegisterCorrection,
  RegisterCorrectionDecideRequest,
  RegisterCorrectionDecisionRequest,
} from './register-correction';
import type { RegisterImport, RegisterImportDecideRequest, RegisterImportDecisionRequest } from './register-import';
import type { RegisterLink, RegisterLinkDecideRequest, RegisterLinkDecisionRequest } from './register-link';
import type { RegisterOpening, RegisterOpeningDecideRequest, RegisterOpeningDecisionRequest } from './register-opening';

export type RegisterEvidence = ApiSchema<'RegisterEvidence'>;
export type RegisterEvidenceKind = ApiSchema<'RegisterEvidenceKindEnum'>;
export type RegisterEvidenceUpload = ApiRequest<'api_v1_tokens_register_evidence_create'>;
export type RegisterDecisionKind = ApiSchema<'RegisterDecisionKindEnum'>;
export type RegisterProposal = RegisterImport | RegisterCorrection | RegisterOpening | RegisterLink;
export type RegisterDecisionRequest =
  | RegisterImportDecisionRequest
  | RegisterCorrectionDecisionRequest
  | RegisterOpeningDecisionRequest
  | RegisterLinkDecisionRequest;
export type RegisterDecideRequest =
  | RegisterImportDecideRequest
  | RegisterCorrectionDecideRequest
  | RegisterOpeningDecideRequest
  | RegisterLinkDecideRequest;

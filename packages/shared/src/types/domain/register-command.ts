import type { ApiRequest, ApiSchema } from '../contracts';
import type {
  RegisterCorrection,
  RegisterCorrectionDecideRequest,
  RegisterCorrectionDecisionRequest,
} from './register-correction';
import type { RegisterImport, RegisterImportDecideRequest, RegisterImportDecisionRequest } from './register-import';
import type { RegisterOpening, RegisterOpeningDecideRequest, RegisterOpeningDecisionRequest } from './register-opening';

export type RegisterEvidence = ApiSchema<'RegisterEvidence'>;
export type RegisterEvidenceKind = ApiSchema<'RegisterEvidenceKindEnum'>;
export type RegisterEvidenceUpload = ApiRequest<'api_v1_tokens_register_evidence_create'>;
export type RegisterDecisionKind = ApiSchema<'RegisterDecisionKindEnum'>;
export type RegisterProposal = RegisterImport | RegisterCorrection | RegisterOpening;
export type RegisterDecisionRequest =
  RegisterImportDecisionRequest | RegisterCorrectionDecisionRequest | RegisterOpeningDecisionRequest;
export type RegisterDecideRequest =
  RegisterImportDecideRequest | RegisterCorrectionDecideRequest | RegisterOpeningDecideRequest;

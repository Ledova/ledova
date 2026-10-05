import type { ApiRequest, ApiSchema } from '../contracts';
import type { RegisterImport, RegisterImportDecideRequest, RegisterImportDecisionRequest } from './register-import';

export type RegisterEvidence = ApiSchema<'RegisterEvidence'>;
export type RegisterEvidenceKind = ApiSchema<'RegisterEvidenceKindEnum'>;
export type RegisterEvidenceUpload = ApiRequest<'api_v1_tokens_register_evidence_create'>;
export type RegisterDecisionKind = ApiSchema<'RegisterDecisionKindEnum'>;
export type RegisterProposal = RegisterImport;
export type RegisterDecisionRequest = RegisterImportDecisionRequest;
export type RegisterDecideRequest = RegisterImportDecideRequest;

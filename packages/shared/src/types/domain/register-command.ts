import type {
  RegisterAllotment,
  RegisterAllotmentDecisionRequest,
  RegisterAllotmentDecideRequest,
} from './register-allotment';
import type { ApiRequest, ApiSchema } from '../contracts';
import type {
  RegisterCorrection,
  RegisterCorrectionDecideRequest,
  RegisterCorrectionDecisionRequest,
} from './register-correction';
import type { RegisterImport, RegisterImportDecideRequest, RegisterImportDecisionRequest } from './register-import';
import type { RegisterGrant, RegisterGrantDecideRequest, RegisterGrantDecisionRequest } from './register-grant';
import type {
  RegisterTransfer,
  RegisterTransferDecideRequest,
  RegisterTransferDecisionRequest,
} from './register-transfer';
import type { RegisterParticularsChange } from './register-particulars';
import type { UploadFile } from './company-authority';

export type RegisterEvidence = ApiSchema<'RegisterEvidence'>;
export type RegisterEvidenceKind = ApiSchema<'RegisterEvidenceKindEnum'>;
export type RegisterEvidenceFile = UploadFile & { size: number };
export type RegisterEvidenceUpload = Omit<ApiRequest<'api_v1_tokens_register_evidence_create'>, 'file'> & {
  file: UploadFile;
};
export type RegisterDecisionKind = ApiSchema<'RegisterDecisionKindEnum'>;
export type RegisterProposal =
  | RegisterAllotment
  | RegisterImport
  | RegisterCorrection
  | RegisterParticularsChange
  | RegisterGrant
  | RegisterTransfer;
export type RegisterDecisionRequest =
  | RegisterAllotmentDecisionRequest
  | RegisterImportDecisionRequest
  | RegisterGrantDecisionRequest
  | RegisterTransferDecisionRequest
  | RegisterCorrectionDecisionRequest;
export type RegisterDecideRequest =
  | RegisterAllotmentDecideRequest
  | RegisterImportDecideRequest
  | RegisterGrantDecideRequest
  | RegisterTransferDecideRequest
  | RegisterCorrectionDecideRequest;

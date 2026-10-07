import type {
  RegisterPauseChange,
  RegisterPauseChangeDecisionRequest,
  RegisterPauseChangeDecideRequest,
} from './register-pause-change';
import type {
  RegisterCapitalIncrease,
  RegisterCapitalIncreaseDecisionRequest,
  RegisterCapitalIncreaseDecideRequest,
} from './register-capital-increase';
import type { RegisterIssue, RegisterIssueDecisionRequest, RegisterIssueDecideRequest } from './register-issue';
import type { ApiRequest, ApiSchema } from '../contracts';
import type {
  CompanyWalletInstruction,
  CompanyWalletDecisionRequest,
  CompanyWalletDecideRequest,
} from './company-wallet';
import type {
  RegisterCorrection,
  RegisterCorrectionDecideRequest,
  RegisterCorrectionDecisionRequest,
} from './register-correction';
import type { RegisterImport, RegisterImportDecideRequest, RegisterImportDecisionRequest } from './register-import';
import type { RegisterGrant, RegisterGrantDecideRequest, RegisterGrantDecisionRequest } from './register-grant';
import type {
  RegisterDeployment,
  RegisterDeploymentDecideRequest,
  RegisterDeploymentDecisionRequest,
} from './register-deployment';
import type {
  RegisterTransfer,
  RegisterTransferDecideRequest,
  RegisterTransferDecisionRequest,
} from './register-transfer';
import type { RegisterLink, RegisterLinkDecideRequest, RegisterLinkDecisionRequest } from './register-link';
import type { RegisterOpening, RegisterOpeningDecideRequest, RegisterOpeningDecisionRequest } from './register-opening';
import type {
  RegisterParticularsChange,
  RegisterParticularsChangeDecideRequest,
  RegisterParticularsChangeDecisionRequest,
} from './register-particulars';

export type RegisterEvidence = ApiSchema<'RegisterEvidence'>;
export type RegisterEvidenceKind = ApiSchema<'RegisterEvidenceKindEnum'>;
export type RegisterEvidenceUpload = ApiRequest<'api_v1_tokens_register_evidence_create'>;
export type RegisterDecisionKind = ApiSchema<'RegisterDecisionKindEnum'>;
export type RegisterProposal =
  | RegisterPauseChange
  | RegisterCapitalIncrease
  | RegisterImport
  | RegisterIssue
  | RegisterCorrection
  | RegisterOpening
  | RegisterParticularsChange
  | RegisterLink
  | RegisterGrant
  | RegisterTransfer
  | RegisterDeployment
  | CompanyWalletInstruction;
export type RegisterDecisionRequest =
  | RegisterPauseChangeDecisionRequest
  | RegisterCapitalIncreaseDecisionRequest
  | RegisterImportDecisionRequest
  | RegisterIssueDecisionRequest
  | RegisterDeploymentDecisionRequest
  | RegisterGrantDecisionRequest
  | RegisterTransferDecisionRequest
  | RegisterCorrectionDecisionRequest
  | RegisterOpeningDecisionRequest
  | RegisterParticularsChangeDecisionRequest
  | RegisterLinkDecisionRequest
  | CompanyWalletDecisionRequest;
export type RegisterDecideRequest =
  | RegisterPauseChangeDecideRequest
  | RegisterCapitalIncreaseDecideRequest
  | RegisterImportDecideRequest
  | RegisterIssueDecideRequest
  | RegisterDeploymentDecideRequest
  | RegisterGrantDecideRequest
  | RegisterTransferDecideRequest
  | RegisterCorrectionDecideRequest
  | RegisterOpeningDecideRequest
  | RegisterParticularsChangeDecideRequest
  | RegisterLinkDecideRequest
  | CompanyWalletDecideRequest;

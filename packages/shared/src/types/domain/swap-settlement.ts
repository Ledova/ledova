import type { ApiSchema } from '../contracts';
import type { ApprovalTransaction } from './trading';

export type SwapSettlementIdentity = Pick<
  SwapSettlementResponse,
  'orderUuid' | 'swapUuid' | 'ownerAccountUuid' | 'walletUuid' | 'settlementDigest'
>;

export type SwapSettlementLookup = Omit<SwapSettlementIdentity, 'settlementDigest'> &
  Partial<Pick<SwapSettlementIdentity, 'settlementDigest'>>;

export interface SwapSettlementSelection extends SwapSettlementLookup {
  walletAddress?: string;
}

export type SwapSettlementParty = ApiSchema<'SettlementParty'>;

export type SwapSettlementTypedData = ApiSchema<'SettlementTypedData'>;

export type SwapSettlementContext = ApiSchema<'SettlementContext'>;

export type SettlementSwapOrder = ApiSchema<'SettlementSwapOrder'>;

export type SwapSettlementResponse = ApiSchema<'SettlementSwapOrderForSigning'>;

export type SwapSettlementApprovalIdentity = SwapSettlementIdentity & Pick<SwapSettlementResponse, 'userRole'>;

export type SwapSettlementApprovalStatus = ApiSchema<'SettlementApprovalStatus'>;

export type SwapSettlementApprovalSufficient = ApiSchema<'SettlementSufficientApproval'>;

export type SwapSettlementApprovalRequired = ApiSchema<'SettlementApprovalTransaction'>;

export type SwapSettlementApprovalData = SwapSettlementApprovalSufficient | SwapSettlementApprovalRequired;

export type SwapSettlementApprovalConfirmed = ApiSchema<'SettlementApprovalReceipt'>;

export type SwapSettlementApprovalUnconfirmed = ApiSchema<'SettlementApprovalUncertain'>;

export type SwapSettlementApprovalOutcome = ApiSchema<'SettlementApprovalOutcome'>;

export type SwapSettlementSignature = Pick<ApiSchema<'SettlementSignatureRequest'>, 'signature' | 'signerAddress'>;

export interface SwapSettlementSignedApproval {
  txHash: string;
  transaction: ApprovalTransaction;
}

export interface SwapSettlementCrypto {
  digestTypedData: (typedData: SwapSettlementTypedData) => string | Promise<string>;
  recoverSigner: (typedData: SwapSettlementTypedData, signature: string) => string | Promise<string>;
  inspectSignedApproval: (raw: string) => SwapSettlementSignedApproval | Promise<SwapSettlementSignedApproval>;
}

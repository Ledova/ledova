import { REGISTER_CORRECTION_COPY, formatShareCount } from '../constants';
import type {
  RegisterCorrection,
  RegisterCorrectionChange,
  RegisterCorrectionPreparation,
  RegisterCorrectionRecord,
  RegisterDecideRequest,
  RegisterEntryChange,
} from '../types';
import { isRegisterDecisionReceipt, rowsOf } from './register-commands';

type RegisterChange = Pick<RegisterEntryChange, 'member' | 'shares'> & { name?: string | null };

export function registerCorrectionOf(record: RegisterCorrectionRecord): RegisterCorrection {
  const { changes } = record;
  if (!rowsOf<RegisterCorrectionChange>(changes, ['member', 'shares']))
    throw new Error(REGISTER_CORRECTION_COPY.CHANGES_UNREADABLE);
  return { ...record, changes };
}

export function isPreparedRegisterCorrection(proposal: RegisterCorrection, request: RegisterCorrectionPreparation) {
  return (
    proposal.uuid === request.operationId &&
    proposal.corrects === request.correctsId &&
    proposal.preparingAppointment === request.appointment &&
    proposal.authorityEvidence === request.authorityEvidence &&
    proposal.effectiveOn === request.effectiveOn &&
    proposal.authority === request.authority &&
    proposal.approvingDirector === (request.approvingDirector ?? '') &&
    proposal.authorityReference === request.authorityReference &&
    proposal.reason === request.reason &&
    proposal.providedBy === 'company'
  );
}

export function isRegisterCorrectionDecisionReceipt(
  proposal: RegisterCorrection,
  uuid: string,
  request: RegisterDecideRequest,
) {
  return isRegisterDecisionReceipt(proposal, uuid, request) && (request.kind !== 'apply' || !!proposal.appliedEntry);
}

export function formatRegisterChanges(changes: RegisterChange[], named: RegisterChange[] = []) {
  const names = new Map(named.map((change) => [change.member, change.name]));
  return changes.map(({ member, shares, name }) => {
    const signed = shares.startsWith('-') ? formatShareCount(shares) : `+${formatShareCount(shares)}`;
    return `${name || names.get(member) || REGISTER_CORRECTION_COPY.UNNAMED_MEMBER(member)}: ${signed}`;
  });
}

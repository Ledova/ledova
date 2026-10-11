import type {
  RegisterAward,
  RegisterAwardPreparation,
  RegisterAwardVesting,
  RegisterAwardVestingPreparation,
} from '../types';
import { wholeShares } from './share-quantities';

export function hasValidRegisterAwardTotals(award: RegisterAward) {
  const values = [award.shares, award.vestedShares, award.issuedShares, award.availableShares];
  if (values.some((value) => typeof value !== 'string')) return false;
  const promised = wholeShares(award.shares);
  const vested = wholeShares(award.vestedShares);
  const issued = wholeShares(award.issuedShares);
  const available = wholeShares(award.availableShares);
  return (
    promised !== null &&
    vested !== null &&
    issued !== null &&
    available !== null &&
    promised > 0n &&
    promised < 2n ** 256n &&
    vested <= promised &&
    issued <= vested &&
    available === vested - issued
  );
}

export function isRecordedRegisterAward(award: RegisterAward, request: RegisterAwardPreparation, company: string) {
  return (
    award.uuid === request.operationId &&
    award.company === company &&
    award.token === request.tokenId &&
    award.preparingAppointment === request.appointment &&
    award.member === request.member &&
    award.newMember === request.newMember &&
    !!award.name.trim() &&
    !!award.residentialAddress.trim() &&
    (!(request.newMember || request.name) || award.name === request.name) &&
    (!(request.newMember || request.residentialAddress) || award.residentialAddress === request.residentialAddress) &&
    award.shares === request.shares &&
    award.termsOn === request.termsOn &&
    award.terms === request.terms &&
    award.schedule === request.schedule &&
    award.agreementEvidence === request.agreementEvidence &&
    /^[0-9a-f]{64}$/.test(award.agreementFingerprint) &&
    award.providedBy === 'company' &&
    hasValidRegisterAwardTotals(award)
  );
}

export function isRecordedRegisterAwardVesting(
  vesting: RegisterAwardVesting,
  request: RegisterAwardVestingPreparation,
  company: string,
) {
  const shares = typeof vesting.shares === 'string' ? wholeShares(vesting.shares) : null;
  return (
    vesting.uuid === request.operationId &&
    vesting.company === company &&
    vesting.preparingAppointment === request.appointment &&
    vesting.award === request.award &&
    vesting.shares === request.shares &&
    shares !== null &&
    shares > 0n &&
    shares < 2n ** 256n &&
    vesting.vestedOn === request.vestedOn &&
    vesting.evidence === request.evidence &&
    /^[0-9a-f]{64}$/.test(vesting.evidenceFingerprint) &&
    vesting.providedBy === 'company'
  );
}

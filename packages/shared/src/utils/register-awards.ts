import type {
  RegisterAward,
  RegisterAwardPreparation,
  RegisterAwardVesting,
  RegisterAwardVestingPreparation,
  RegisterAwardEnd,
  RegisterAwardEndPreparation,
  RegisterAwardVestingReversal,
  RegisterAwardVestingReversalPreparation,
  OwnMemberRecord,
} from '../types';

function awardQuantity(value: string) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(value)) return null;
  const quantity = BigInt(value);
  return quantity < 2n ** 256n ? quantity : null;
}

export function hasValidRegisterAwardTotals(
  award: Pick<
    RegisterAward,
    | 'shares'
    | 'vestedShares'
    | 'issuedShares'
    | 'availableShares'
    | 'endedUnvestedShares'
    | 'endedVestedShares'
    | 'unvestedRemainingShares'
    | 'remainingUnissuedShares'
  >,
) {
  const promised = awardQuantity(award.shares);
  const vested = awardQuantity(award.vestedShares);
  const issued = awardQuantity(award.issuedShares);
  const available = awardQuantity(award.availableShares);
  const endedUnvested = awardQuantity(award.endedUnvestedShares);
  const endedVested = awardQuantity(award.endedVestedShares);
  const unvestedRemaining = awardQuantity(award.unvestedRemainingShares);
  const remainingUnissued = awardQuantity(award.remainingUnissuedShares);
  return (
    promised !== null &&
    vested !== null &&
    issued !== null &&
    available !== null &&
    endedUnvested !== null &&
    endedVested !== null &&
    unvestedRemaining !== null &&
    remainingUnissued !== null &&
    promised > 0n &&
    promised < 2n ** 256n &&
    vested <= promised &&
    issued <= vested &&
    available === vested - issued - endedVested &&
    unvestedRemaining === promised - vested - endedUnvested &&
    remainingUnissued === promised - issued - endedUnvested - endedVested &&
    remainingUnissued === unvestedRemaining + available
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
  const shares = awardQuantity(vesting.shares);
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

export function isRecordedRegisterAwardEnd(
  end: RegisterAwardEnd,
  request: RegisterAwardEndPreparation,
  company: string,
  expectedEvidenceFingerprint?: string,
) {
  return (
    hasValidRegisterAwardEnd(end) &&
    end.uuid === request.operationId &&
    end.company === company &&
    end.award === request.award &&
    end.preparingAppointment === request.appointment &&
    end.unvestedShares === request.unvestedShares &&
    end.vestedShares === request.vestedShares &&
    end.companyEventOn === request.companyEventOn &&
    end.reason === request.reason &&
    end.evidence === request.evidence &&
    (expectedEvidenceFingerprint === undefined || end.evidenceFingerprint === expectedEvidenceFingerprint) &&
    end.providedBy === 'company'
  );
}

export function isRecordedRegisterAwardVestingReversal(
  reversal: RegisterAwardVestingReversal,
  request: RegisterAwardVestingReversalPreparation,
  company: string,
  award: string,
  expectedEvidenceFingerprint?: string,
) {
  return (
    hasValidRegisterAwardVestingReversal(reversal) &&
    reversal.uuid === request.operationId &&
    reversal.company === company &&
    reversal.award === award &&
    reversal.vesting === request.vesting &&
    reversal.preparingAppointment === request.appointment &&
    reversal.reversedShares === request.reversedShares &&
    reversal.companyEventOn === request.companyEventOn &&
    reversal.reason === request.reason &&
    reversal.evidence === request.evidence &&
    (expectedEvidenceFingerprint === undefined || reversal.evidenceFingerprint === expectedEvidenceFingerprint) &&
    reversal.providedBy === 'company'
  );
}

function hasValidAwardFact(
  fact: Pick<
    RegisterAwardEnd,
    | 'uuid'
    | 'company'
    | 'award'
    | 'companyEventOn'
    | 'reason'
    | 'evidence'
    | 'evidenceFingerprint'
    | 'preparingAppointment'
    | 'providedBy'
    | 'createdAt'
  >,
) {
  return (
    hasValidSafeAwardFact(fact) &&
    [fact.uuid, fact.company, fact.award, fact.preparingAppointment, fact.evidence].every(
      (value) => typeof value === 'string' && !!value.trim(),
    ) &&
    typeof fact.evidenceFingerprint === 'string' &&
    /^[0-9a-f]{64}$/.test(fact.evidenceFingerprint) &&
    fact.providedBy === 'company'
  );
}

function hasValidSafeAwardFact(fact: Pick<RegisterAwardEnd, 'uuid' | 'companyEventOn' | 'reason' | 'createdAt'>) {
  if (!fact || typeof fact.companyEventOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fact.companyEventOn))
    return false;
  const eventTime = Date.parse(`${fact.companyEventOn}T00:00:00Z`);
  return (
    typeof fact.uuid === 'string' &&
    !!fact.uuid.trim() &&
    Number.isFinite(eventTime) &&
    new Date(eventTime).toISOString().slice(0, 10) === fact.companyEventOn &&
    typeof fact.reason === 'string' &&
    !!fact.reason.trim() &&
    fact.reason.length <= 1000 &&
    typeof fact.createdAt === 'string' &&
    Number.isFinite(Date.parse(fact.createdAt))
  );
}

export function hasValidOwnMemberAward(award: OwnMemberRecord['awards'][number]) {
  if (
    !award ||
    !hasValidRegisterAwardTotals(award) ||
    !Array.isArray(award.vestings) ||
    !Array.isArray(award.ends) ||
    !Array.isArray(award.vestingReversals)
  )
    return false;
  const vestings = new Map<string, bigint>();
  let vested = 0n;
  for (const fact of award.vestings) {
    if (
      !fact ||
      typeof fact.uuid !== 'string' ||
      !fact.uuid.trim() ||
      vestings.has(fact.uuid) ||
      typeof fact.vestedOn !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(fact.vestedOn)
    )
      return false;
    const shares = awardQuantity(fact.shares);
    const time = Date.parse(`${fact.vestedOn}T00:00:00Z`);
    if (
      shares === null ||
      shares === 0n ||
      !Number.isFinite(time) ||
      new Date(time).toISOString().slice(0, 10) !== fact.vestedOn
    )
      return false;
    vestings.set(fact.uuid, shares);
    vested += shares;
  }
  const seenEnds = new Set<string>();
  let endedUnvested = 0n;
  let endedVested = 0n;
  for (const fact of award.ends) {
    if (!hasValidSafeAwardFact(fact) || seenEnds.has(fact.uuid)) return false;
    const unvested = awardQuantity(fact.unvestedShares);
    const shares = awardQuantity(fact.vestedShares);
    if (unvested === null || shares === null || unvested + shares === 0n) return false;
    seenEnds.add(fact.uuid);
    endedUnvested += unvested;
    endedVested += shares;
  }
  const seenReversals = new Set<string>();
  const reversed = new Map<string, bigint>();
  for (const fact of award.vestingReversals) {
    if (
      !hasValidSafeAwardFact(fact) ||
      seenReversals.has(fact.uuid) ||
      typeof fact.vesting !== 'string' ||
      !vestings.has(fact.vesting)
    )
      return false;
    const shares = awardQuantity(fact.reversedShares);
    if (shares === null || shares === 0n) return false;
    const total = (reversed.get(fact.vesting) ?? 0n) + shares;
    if (total > vestings.get(fact.vesting)!) return false;
    seenReversals.add(fact.uuid);
    reversed.set(fact.vesting, total);
    vested -= shares;
  }
  return (
    vested === BigInt(award.vestedShares) &&
    endedUnvested === BigInt(award.endedUnvestedShares) &&
    endedVested === BigInt(award.endedVestedShares)
  );
}

export function hasValidRegisterAwardEnd(end: RegisterAwardEnd) {
  if (!hasValidAwardFact(end)) return false;
  const unvested = awardQuantity(end.unvestedShares);
  const vested = awardQuantity(end.vestedShares);
  return unvested !== null && vested !== null && unvested + vested > 0n && unvested + vested < 2n ** 256n;
}

export function hasValidRegisterAwardVestingReversal(reversal: RegisterAwardVestingReversal) {
  if (!hasValidAwardFact(reversal)) return false;
  const shares = awardQuantity(reversal.reversedShares);
  return typeof reversal.vesting === 'string' && !!reversal.vesting.trim() && shares !== null && shares > 0n;
}

export function remainingRegisterAwardVesting(
  vesting: Pick<RegisterAwardVesting, 'uuid' | 'shares'>,
  reversals: readonly Pick<RegisterAwardVestingReversal, 'uuid' | 'vesting' | 'reversedShares'>[],
) {
  const shares = awardQuantity(vesting.shares);
  if (
    shares === null ||
    shares === 0n ||
    typeof vesting.uuid !== 'string' ||
    !vesting.uuid.trim() ||
    !Array.isArray(reversals)
  )
    return null;
  const seen = new Set<string>();
  let reversed = 0n;
  for (const reversal of reversals) {
    if (
      !reversal ||
      typeof reversal.uuid !== 'string' ||
      !reversal.uuid.trim() ||
      typeof reversal.vesting !== 'string' ||
      !reversal.vesting.trim() ||
      seen.has(reversal.uuid)
    )
      return null;
    const quantity = awardQuantity(reversal.reversedShares);
    if (quantity === null || quantity === 0n) return null;
    seen.add(reversal.uuid);
    if (reversal.vesting === vesting.uuid) reversed += quantity;
  }
  return reversed <= shares ? (shares - reversed).toString() : null;
}

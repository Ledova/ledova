import type {
  RegisterAllotment,
  RegisterAllotmentPreparation,
  RegisterAllotmentDecisionPreview,
  RegisterDecideRequest,
} from '../types';
import { isRegisterDecisionReceipt } from './register-commands';

export function allotmentAud(value: string) {
  const match = /^(0|[1-9]\d{0,17})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = match[1]!;
  const decimals = (match[2] ?? '').padEnd(2, '0');
  if (BigInt(whole) * 100n + BigInt(decimals) === 0n) return null;
  return `${whole}.${decimals}`;
}

function ownershipShares(value: string) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,77})$/.test(value)) return null;
  const shares = BigInt(value);
  return shares < 2n ** 256n ? shares : null;
}

function ownershipDecimal(value: bigint, places: number) {
  const digits = value.toString().padStart(places + 1, '0');
  return `${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

function ownershipPercentage(shares: bigint, supply: bigint) {
  return supply === 0n ? '—' : `${ownershipDecimal((shares * 20_000n + supply) / (supply * 2n), 2)}%`;
}

export function allotmentOwnershipImpact(preview: RegisterAllotmentDecisionPreview) {
  if (
    !preview ||
    preview.currency !== 'AUD' ||
    typeof preview.newMember !== 'boolean' ||
    typeof preview.canDecide !== 'boolean' ||
    typeof preview.member !== 'string' ||
    !preview.member.trim() ||
    typeof preview.name !== 'string' ||
    !preview.name.trim() ||
    typeof preview.className !== 'string' ||
    !preview.className.trim() ||
    typeof preview.classCode !== 'string' ||
    !preview.classCode.trim() ||
    !Array.isArray(preview.currentHolders) ||
    !Array.isArray(preview.unmetRequirements) ||
    preview.unmetRequirements.includes('allotment_decided') ||
    ('status' in preview && preview.status !== 'submitted') ||
    ('registerEntry' in preview && preview.registerEntry !== null) ||
    typeof preview.consideration !== 'string'
  )
    return null;
  const amount = allotmentAud(preview.consideration);
  const shares = ownershipShares(preview.shares);
  const issued = ownershipShares(preview.issuedSupply);
  const afterIssued = ownershipShares(preview.afterIssuedSupply);
  const authorised = ownershipShares(preview.authorisedSupply);
  const current = ownershipShares(preview.currentShares);
  const after = ownershipShares(preview.afterShares);
  if (
    amount === null ||
    shares === null ||
    shares === 0n ||
    issued === null ||
    afterIssued === null ||
    authorised === null ||
    current === null ||
    after === null ||
    current > issued ||
    afterIssued !== issued + shares ||
    afterIssued > authorised ||
    after !== current + shares ||
    (preview.newMember && current !== 0n)
  )
    return null;
  const seen = new Set<string>();
  let total = 0n;
  let recipientShares = 0n;
  for (const holder of preview.currentHolders) {
    if (
      !holder ||
      typeof holder.member !== 'string' ||
      !holder.member.trim() ||
      (holder.name !== null && (typeof holder.name !== 'string' || !holder.name.trim())) ||
      (holder.member.toLowerCase() === preview.member.toLowerCase() && holder.member !== preview.member) ||
      seen.has(holder.member.toLowerCase())
    )
      return null;
    const held = ownershipShares(holder.shares);
    if (held === null || held === 0n) return null;
    seen.add(holder.member.toLowerCase());
    total += held;
    if (holder.member === preview.member) recipientShares = held;
  }
  if (total !== issued || recipientShares !== current) return null;
  const holders = [
    { member: preview.member, name: preview.name, shares: preview.currentShares },
    ...preview.currentHolders.filter((holder) => holder.member !== preview.member),
  ];
  const cents = BigInt(amount.replace('.', ''));
  const unitPrice = (cents * 200n + shares) / (shares * 2n);
  return {
    consideration: preview.consideration,
    unitPrice: cents * 100n < shares ? '< AUD 0.0001' : `AUD ${ownershipDecimal(unitPrice, 4)}`,
    beforeIssuedSupply: preview.issuedSupply,
    afterIssuedSupply: preview.afterIssuedSupply,
    rows: holders.map((holder) => {
      const beforeShares = BigInt(holder.shares);
      const recipient = holder.member === preview.member;
      const afterShares = recipient ? beforeShares + shares : beforeShares;
      return {
        member: holder.member,
        name: holder.name,
        recipient,
        beforeShares: holder.shares,
        afterShares: afterShares.toString(),
        beforePercentage: ownershipPercentage(beforeShares, issued),
        afterPercentage: ownershipPercentage(afterShares, afterIssued),
      };
    }),
  };
}

export function isPreparedRegisterAllotment(
  allotment: RegisterAllotment,
  request: RegisterAllotmentPreparation,
  company: string,
) {
  return (
    allotment.uuid === request.operationId &&
    allotment.company === company &&
    allotment.token === request.tokenId &&
    allotment.preparingAppointment === request.appointment &&
    allotment.member === request.member &&
    allotment.newMember === request.newMember &&
    !!allotment.name.trim() &&
    !!allotment.residentialAddress.trim() &&
    (!request.newMember ||
      (allotment.name === request.name && allotment.residentialAddress === request.residentialAddress)) &&
    allotment.shares === request.shares &&
    allotment.companyEventOn === request.companyEventOn &&
    allotment.currency === 'AUD' &&
    request.currency === 'AUD' &&
    allotmentAud(allotment.consideration) === allotmentAud(request.consideration) &&
    allotmentAud(request.consideration) !== null &&
    allotment.agreement.reference === request.agreementReference &&
    allotment.agreement.agreedOn === request.agreementOn &&
    allotment.agreement.terms === request.terms &&
    allotment.agreement.evidence === request.agreementEvidence &&
    /^[0-9a-f]{64}$/.test(allotment.agreement.evidenceFingerprint) &&
    allotment.contribution.companyRecorded === true &&
    allotment.contribution.currency === 'AUD' &&
    allotmentAud(allotment.contribution.amount) === allotmentAud(request.receivedAmount) &&
    allotmentAud(request.receivedAmount) === allotmentAud(request.consideration) &&
    allotment.contribution.receivedOn === request.receivedOn &&
    allotment.contribution.evidence === request.receiptEvidence &&
    /^[0-9a-f]{64}$/.test(allotment.contribution.evidenceFingerprint) &&
    allotment.approvingDirector === request.approvingDirector &&
    allotment.authorityReference === request.authorityReference &&
    allotment.reason === request.reason &&
    allotment.authorityEvidence === request.authorityEvidence &&
    allotment.providedBy === 'company' &&
    (allotment.status !== 'applied' || (!!allotment.registerEntry && allotment.effectiveOn === request.companyEventOn))
  );
}

export function isRegisterAllotmentDecisionReceipt(
  allotment: RegisterAllotment,
  uuid: string,
  request: RegisterDecideRequest,
  preview?: RegisterAllotmentDecisionPreview,
) {
  return (
    isRegisterDecisionReceipt(allotment, uuid, request) &&
    (!preview ||
      (allotment.member === preview.member &&
        allotment.companyEventOn === preview.companyEventOn &&
        allotment.name === preview.name &&
        allotment.residentialAddress === preview.residentialAddress &&
        allotment.shares === preview.shares &&
        allotment.consideration === preview.consideration &&
        allotment.currency === preview.currency &&
        allotment.approvingDirector === preview.approvingDirector &&
        allotment.authorityReference === preview.authorityReference &&
        allotment.reason === preview.reason &&
        allotment.agreement.uuid === preview.agreement.uuid &&
        allotment.agreement.reference === preview.agreement.reference &&
        allotment.agreement.agreedOn === preview.agreement.agreedOn &&
        allotment.agreement.terms === preview.agreement.terms &&
        allotment.agreement.evidenceFingerprint === preview.agreement.evidenceFingerprint &&
        allotment.contribution.uuid === preview.contribution.uuid &&
        allotment.contribution.companyRecorded === true &&
        allotment.contribution.currency === 'AUD' &&
        allotment.contribution.amount === preview.contribution.amount &&
        allotment.contribution.receivedOn === preview.contribution.receivedOn &&
        allotment.contribution.evidenceFingerprint === preview.contribution.evidenceFingerprint)) &&
    (request.kind !== 'apply' || (!!allotment.registerEntry && allotment.effectiveOn === preview?.effectiveOn))
  );
}

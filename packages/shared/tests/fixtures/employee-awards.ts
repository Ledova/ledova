import type {
  OwnCompanyAppointment,
  RegisterAward,
  RegisterAwardPreparation,
  RegisterAwardVesting,
  RegisterAwardVestingPreparation,
  TokenHoldersResponse,
} from '../../src';

export const APPOINTMENT: OwnCompanyAppointment = {
  signupTerms: null,
  uuid: 'appointment-a',
  company: 'company-a',
  companyName: 'Synthetic Company',
  capabilities: ['admin'],
  delegatableCapabilities: [],
  status: 'active',
  isEffective: true,
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-10-07T00:00:00Z',
  source: 'invitation',
  declarationText: null,
  declarationVersion: null,
};

export const AWARD_REQUEST: RegisterAwardPreparation = {
  operationId: 'award-a',
  appointment: APPOINTMENT.uuid,
  tokenId: 'ordinary',
  member: 'promised-member',
  newMember: true,
  name: 'Synthetic Recipient',
  residentialAddress: '1 Synthetic Street, Sydney NSW 2000',
  shares: '100',
  termsOn: '2020-01-01',
  terms: 'Non-paid agreement',
  schedule: 'The company separately confirms each vesting event',
  agreementEvidence: 'agreement-a',
};

export function awardFrom(body: RegisterAwardPreparation): RegisterAward {
  return {
    uuid: body.operationId,
    company: APPOINTMENT.company,
    token: body.tokenId,
    member: body.member,
    newMember: body.newMember,
    name: body.name || 'Retained Recipient',
    residentialAddress: body.residentialAddress || AWARD_REQUEST.residentialAddress!,
    shares: body.shares,
    termsOn: body.termsOn,
    terms: body.terms,
    schedule: body.schedule,
    agreementEvidence: body.agreementEvidence,
    agreementFingerprint: 'a'.repeat(64),
    agreementSnapshot: {},
    preparingAppointment: body.appointment,
    preparedByName: 'Synthetic Preparer',
    submittedBy: 1,
    providedBy: 'company',
    createdAt: '2026-10-07T00:00:00Z',
    vestedShares: '0',
    issuedShares: '0',
    availableShares: '0',
  };
}

export function vestingFrom(body: RegisterAwardVestingPreparation): RegisterAwardVesting {
  return {
    uuid: body.operationId,
    company: APPOINTMENT.company,
    award: body.award,
    shares: body.shares,
    vestedOn: body.vestedOn,
    evidence: body.evidence,
    evidenceFingerprint: 'a'.repeat(64),
    evidenceSnapshot: {},
    preparingAppointment: body.appointment,
    preparedByName: 'Synthetic Preparer',
    submittedBy: 1,
    providedBy: 'company',
    createdAt: '2026-10-07T00:00:00Z',
  };
}

export const REGISTER: TokenHoldersResponse = {
  token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'draft', totalSupply: '1000' },
  issuedSupply: '0',
  initialized: true,
  waitingEffects: 0,
  totalHolders: 0,
  holders: [],
  formerMembers: [],
  formerMembersAsAt: null,
  formerMembersBlock: null,
  formerMembersStale: false,
};

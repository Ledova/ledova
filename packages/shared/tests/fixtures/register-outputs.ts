import type { RegisterCertificatePreview, RegisterEntry } from '../../src';
import { APPOINTMENT, REGISTER } from './employee-awards';
import { MEMBER_ENTRY, MEMBER_RECORD } from './member-access';

export const OUTPUT_APPOINTMENT = {
  ...APPOINTMENT,
  uuid: '22222222-2222-4222-8222-222222222222',
  company: MEMBER_RECORD.company.uuid,
};
export const OUTPUT_REGISTER = {
  ...REGISTER,
  token: { ...REGISTER.token, uuid: MEMBER_RECORD.classes[0]!.uuid },
  issuedSupply: '10',
  totalHolders: 1,
  holders: [
    {
      member: MEMBER_RECORD.member,
      name: MEMBER_RECORD.name,
      holderType: 'member' as const,
      balance: '10',
      shareClass: REGISTER.token.name,
      source: 'register',
      identitySource: 'company_recorded',
      enteredOn: '2026-10-01',
      percentage: 100,
      wallets: [],
    },
  ],
};
export const OUTPUT_ENTRY: RegisterEntry = {
  uuid: MEMBER_ENTRY.uuid,
  sequence: MEMBER_ENTRY.sequence,
  kind: 'issue',
  companyEventOn: null,
  effectiveOn: MEMBER_ENTRY.effectiveOn,
  recordedAt: MEMBER_ENTRY.createdAt,
  corrects: null,
  correctedBy: null,
  correctable: true,
  changes: [{ member: MEMBER_RECORD.member, name: MEMBER_RECORD.name, shares: '10' }],
};
export const OUTPUT_PREVIEW: RegisterCertificatePreview = {
  token: OUTPUT_REGISTER.token.uuid,
  entry: OUTPUT_ENTRY.uuid,
  appointment: OUTPUT_APPOINTMENT.uuid,
  sequence: OUTPUT_ENTRY.sequence,
  registerSequence: OUTPUT_ENTRY.sequence,
  pageCount: 1,
  sourceDigest: 'a'.repeat(64),
};

import type { MemberCertificateRequest, RegisterCertificatePreview, RegisterEntry } from '../../src';
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
export const MEMBER_PDF = Uint8Array.from('%PDF synthetic recipient', (value) => value.charCodeAt(0));
export const FULFILLED_CERTIFICATE: MemberCertificateRequest = {
  uuid: '33333333-3333-4333-8333-333333333333',
  association: MEMBER_RECORD.uuid,
  company: MEMBER_RECORD.company.uuid,
  member: MEMBER_RECORD.member,
  token: OUTPUT_REGISTER.token.uuid,
  entry: OUTPUT_ENTRY.uuid,
  status: 'fulfilled',
  requestedBy: 1,
  createdAt: MEMBER_ENTRY.createdAt,
  fulfilment: {
    uuid: '44444444-4444-4444-8444-444444444444',
    producedBy: 2,
    appointment: OUTPUT_APPOINTMENT.uuid,
    instruction: 'Synthetic recipient certificate instruction',
    sourceDigest: OUTPUT_PREVIEW.sourceDigest,
    digest: '63ea80f0af59928afc20d529c511a893a40ca4d4daf31839a0d6ecd3d9906e6f',
    fileSize: MEMBER_PDF.byteLength,
    createdAt: MEMBER_ENTRY.createdAt,
  },
};

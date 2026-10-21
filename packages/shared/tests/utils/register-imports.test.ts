import {
  isPreparedRegisterImport,
  isRegisterMemberDocument,
  isRegisterMemberDocumentReceipt,
  registerImportMoney,
  type RegisterImportPreparation,
  type RegisterImportRecord,
} from '../../src';
import { registerImportOf } from '../../src/utils/register-imports';

it('matches the complete company mirror and retained correction source without inventing older allotment particulars', () => {
  const request: RegisterImportPreparation = {
    operationId: 'snapshot-a',
    appointment: 'appointment-a',
    tokenId: 'class-a',
    asAt: '2026-10-14',
    sourceReference: 'Company register dated 14 October',
    sourceConfirmed: true,
    reason: 'Mirror existing records',
    correctionOf: 'snapshot-before',
    formerMembers: [
      { name: 'Former shareholder', residentialAddress: 'Previous address', shares: '10', ceasedOn: '2026-09-01' },
    ],
    members: [
      {
        member: 'member-a',
        name: 'Example Shareholder',
        residentialAddress: '1 Example Street',
        shares: '600',
        enteredOn: '2020-01-01',
        allotments: [
          {
            allottedOn: '2020-01-01',
            shares: '600',
            shareReference: '1–600',
            certificateReference: null,
            amountPaid: '600',
            amountUnpaid: '0',
            fullyPaid: true,
            beneficiallyHeld: true,
          },
        ],
      },
    ],
  };
  const record: RegisterImportRecord = {
    uuid: request.operationId,
    company: 'company-a',
    token: request.tokenId,
    asAt: request.asAt,
    sourceReference: request.sourceReference,
    sourceConfirmed: true,
    correctionOf: request.correctionOf!,
    correctionAllowed: false,
    preparingAppointment: request.appointment,
    preparedByName: 'Example Director',
    submittedBy: 1,
    members: request.members.map((row) => ({
      ...row,
      amountPaid: '600.00',
      allotments: row.allotments.map((allotment) => ({ ...allotment, amountPaid: '600.00', amountUnpaid: '0.00' })),
    })),
    formerMembers: request.formerMembers,
    authority: 'company_records',
    approvingDirector: '',
    authorityReference: request.sourceReference,
    reason: request.reason,
    registerEvidence: null,
    sourceDocument: null,
    evidenceFingerprint: '',
    evidenceSnapshot: {},
    asicEvidence: null,
    asicDocument: null,
    asicFingerprint: '',
    asicSnapshot: {},
    asicIssuedTotal: null,
    asicMemberCount: null,
    decisions: [],
    registerSequence: null,
    rejectionReason: '',
    reviewedAt: null,
    reviewedBy: null,
    providedBy: 'company',
    stage: 'submitted',
    status: 'submitted',
    createdAt: '2026-10-14T00:00:00Z',
  };
  const proposal = registerImportOf(record);
  const evidence = '10000000-0000-4000-8000-000000000001';
  const attachment = {
    evidence,
    category: 'share_certificate' as const,
    snapshot: {
      providedBy: 'company' as const,
      evidence,
      company: record.company,
      documentType: 'supporting' as const,
      name: 'certificate.pdf',
      fileSize: 100,
      mimeType: 'application/pdf',
      sha256: 'a'.repeat(64),
    },
  };
  const documentRequest: RegisterImportPreparation = {
    ...request,
    members: request.members.map((member) => ({ ...member, documents: [{ evidence, category: attachment.category }] })),
  };
  const withDocuments = registerImportOf({
    ...record,
    members: proposal.members.map((member) => ({ ...member, documents: [attachment] })),
  });
  expect(isPreparedRegisterImport(withDocuments, documentRequest)).toBe(true);
  expect(isPreparedRegisterImport(withDocuments, request)).toBe(false);
  expect(isPreparedRegisterImport(proposal, documentRequest)).toBe(false);
  expect(
    isPreparedRegisterImport(
      {
        ...withDocuments,
        members: withDocuments.members.map((member) => ({
          ...member,
          documents: [{ ...attachment, category: 'subscription_agreement' }],
        })),
      },
      documentRequest,
    ),
  ).toBe(false);
  for (const documents of [
    [attachment, attachment],
    [{ ...attachment, category: 'unknown' }],
    [{ ...attachment, snapshot: { ...attachment.snapshot, company: 'foreign-company' } }],
    [{ ...attachment, snapshot: { ...attachment.snapshot, evidence: 'another-file' } }],
    [{ ...attachment, snapshot: undefined }],
    [{ ...attachment, snapshot: { ...attachment.snapshot, sha256: 'invalid' } }],
  ])
    expect(() =>
      registerImportOf({
        ...record,
        members: proposal.members.map((member) => ({ ...member, documents })),
      }),
    ).toThrow('The register import rows could not be read.');
  const documentLink = {
    uuid: '20000000-0000-4000-8000-000000000001',
    company: '30000000-0000-4000-8000-000000000001',
    member: '40000000-0000-4000-8000-000000000001',
    token: '50000000-0000-4000-8000-000000000001',
    sourceImport: null,
    evidence,
    category: attachment.category,
    snapshot: { ...attachment.snapshot, company: '30000000-0000-4000-8000-000000000001' },
    appointment: '60000000-0000-4000-8000-000000000001',
    idempotencyKey: '70000000-0000-4000-8000-000000000001',
    createdAt: '2026-10-21T00:00:00Z',
  };
  const linkRequest = { ...documentLink, companyId: documentLink.company };
  expect(isRegisterMemberDocumentReceipt(documentLink, linkRequest)).toBe(true);
  expect(isRegisterMemberDocumentReceipt({ ...documentLink, member: documentLink.token }, linkRequest)).toBe(false);
  expect(isRegisterMemberDocument({ ...documentLink, snapshot: attachment.snapshot })).toBe(false);
  expect(registerImportMoney('0')).toBe('0.00');
  expect(registerImportMoney('0.001')).toBeNull();
  expect(isPreparedRegisterImport(proposal, request)).toBe(true);
  expect(isPreparedRegisterImport({ ...proposal, sourceReference: 'Other company records' }, request)).toBe(false);
  expect(isPreparedRegisterImport({ ...proposal, correctionOf: null }, request)).toBe(false);
  expect(
    isPreparedRegisterImport({ ...proposal, formerMembers: [{ ...request.formerMembers[0]!, shares: '11' }] }, request),
  ).toBe(false);
  for (const change of [
    { certificateReference: 'different' },
    { shareReference: 'different' },
    { beneficiallyHeld: false },
    { beneficiallyHeld: null },
    { allottedOn: '2020-02-01' },
    { amountUnpaid: '1.00', fullyPaid: false },
  ]) {
    const member = proposal.members[0]!;
    const altered = { ...proposal, members: [{ ...member, allotments: [{ ...member.allotments![0]!, ...change }] }] };
    expect(isPreparedRegisterImport(altered, request)).toBe(false);
  }
  const unknownRequest: RegisterImportPreparation = {
    ...request,
    members: request.members.map((member) => ({
      ...member,
      allotments: member.allotments.map((allotment) => ({ ...allotment, beneficiallyHeld: null })),
    })),
  };
  const unknownRecord: RegisterImportRecord = {
    ...record,
    members: proposal.members.map((member) => ({
      ...member,
      allotments: member.allotments!.map((allotment) => ({ ...allotment, beneficiallyHeld: null })),
    })),
  };
  const unknown = registerImportOf(unknownRecord);
  expect(unknown.members[0]!.allotments![0]!.beneficiallyHeld).toBeNull();
  expect(isPreparedRegisterImport(unknown, unknownRequest)).toBe(true);
  expect(isPreparedRegisterImport(proposal, unknownRequest)).toBe(false);
  for (const status of [undefined, '', 0, 'false']) {
    expect(() =>
      registerImportOf({
        ...unknownRecord,
        members: unknown.members.map((member) => ({
          ...member,
          allotments: member.allotments!.map((allotment) => ({ ...allotment, beneficiallyHeld: status })),
        })),
      }),
    ).toThrow('The register import rows could not be read.');
  }
  const oldMember = { ...proposal.members[0]! };
  delete oldMember.allotments;
  const older = registerImportOf({
    ...record,
    authority: 'director_resolution',
    authorityReference: 'Retained board resolution',
    approvingDirector: 'Earlier director',
    sourceReference: '',
    sourceConfirmed: false,
    correctionOf: null,
    members: [oldMember],
  });
  expect(older.members[0]!.allotments).toBeUndefined();
  expect(isPreparedRegisterImport(older, request)).toBe(false);
  expect(() => registerImportOf({ ...record, members: [oldMember] })).toThrow(
    'The register import rows could not be read.',
  );
  expect(() => registerImportOf({ ...record, members: [{ ...proposal.members[0]!, amountPaid: '1.00' }] })).toThrow(
    'The register import rows could not be read.',
  );
});

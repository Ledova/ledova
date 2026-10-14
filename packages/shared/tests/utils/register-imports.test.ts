import {
  isPreparedRegisterImport,
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
    { allottedOn: '2020-02-01' },
    { amountUnpaid: '1.00', fullyPaid: false },
  ]) {
    const member = proposal.members[0]!;
    const altered = { ...proposal, members: [{ ...member, allotments: [{ ...member.allotments![0]!, ...change }] }] };
    expect(isPreparedRegisterImport(altered, request)).toBe(false);
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

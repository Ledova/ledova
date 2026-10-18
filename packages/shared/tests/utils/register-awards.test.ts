import type { AxiosInstance } from 'axios';
import {
  hasValidRegisterAwardTotals,
  isPreparedRegisterGrant,
  isRecordedRegisterAward,
  isRecordedRegisterAwardVesting,
  hasValidRegisterAwardEnd,
  hasValidRegisterAwardVestingReversal,
  isRecordedRegisterAwardEnd,
  isRecordedRegisterAwardVestingReversal,
  remainingRegisterAwardVesting,
  getOwnMemberRecords,
  getOwnMemberRecord,
  REGISTER_AWARD_COPY,
  type RegisterGrant,
  type RegisterAwardEndPreparation,
  type RegisterAwardVestingReversalPreparation,
  type OwnMemberRecord,
} from '../../src';
import {
  APPOINTMENT,
  AWARD_REQUEST,
  awardFrom,
  vestingFrom,
  endFrom,
  vestingReversalFrom,
} from '../fixtures/employee-awards';
import { MEMBER_RECORD } from '../fixtures/member-access';

it('confirms exact bound receipts and rejects foreign or impossible award quantities beyond safe integer precision', async () => {
  const request = { ...AWARD_REQUEST, shares: '9007199254740995' };
  const award = {
    ...awardFrom(request),
    vestedShares: '9007199254740994',
    issuedShares: '9007199254740993',
    availableShares: '1',
    unvestedRemainingShares: '1',
    remainingUnissuedShares: '2',
  };
  expect(isRecordedRegisterAward(award, request, APPOINTMENT.company)).toBe(true);
  expect(isRecordedRegisterAward({ ...award, company: 'foreign-company' }, request, APPOINTMENT.company)).toBe(false);
  expect(hasValidRegisterAwardTotals({ ...award, issuedShares: '9007199254740995' })).toBe(false);
  expect(hasValidRegisterAwardTotals({ ...award, availableShares: '2' })).toBe(false);
  const event = {
    operationId: 'vesting-a',
    appointment: APPOINTMENT.uuid,
    award: request.operationId,
    shares: '9007199254740994',
    vestedOn: '2020-01-01',
    evidence: 'vesting-evidence',
  };
  expect(isRecordedRegisterAwardVesting(vestingFrom(event), event, APPOINTMENT.company)).toBe(true);
  expect(
    isRecordedRegisterAwardVesting({ ...vestingFrom(event), award: 'foreign-award' }, event, APPOINTMENT.company),
  ).toBe(false);
  const grantRequest = {
    ...request,
    operationId: 'grant-a',
    award: award.uuid,
    companyEventOn: '2026-10-18',
    approvingDirector: 'Synthetic Director',
    authorityReference: 'Synthetic resolution',
    reason: 'Issue vested shares',
    authorityEvidence: 'authority-a',
    termsEvidence: award.agreementEvidence,
    acceptanceRequired: false,
  };
  const grant: RegisterGrant = {
    ...award,
    ...grantRequest,
    uuid: grantRequest.operationId,
    token: grantRequest.tokenId,
    termsFingerprint: award.agreementFingerprint,
    termsSnapshot: award.agreementSnapshot,
    evidenceFingerprint: 'b'.repeat(64),
    evidenceSnapshot: {},
    acceptanceEvidence: null,
    acceptanceFingerprint: '',
    acceptanceSnapshot: {},
    status: 'submitted',
    stage: 'submitted',
    registerEntry: null,
    effectiveOn: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
  };
  expect(isPreparedRegisterGrant(grant, grantRequest, award.agreementFingerprint)).toBe(true);
  expect(
    isPreparedRegisterGrant({ ...grant, termsFingerprint: 'c'.repeat(64) }, grantRequest, award.agreementFingerprint),
  ).toBe(false);
  expect(isPreparedRegisterGrant(grant, grantRequest, '')).toBe(false);
  expect(isPreparedRegisterGrant(grant, grantRequest, 'invalid')).toBe(false);
  const originalUpload = { ...grantRequest, termsEvidence: 'historical-upload' };
  expect(isPreparedRegisterGrant({ ...grant, termsEvidence: originalUpload.termsEvidence }, originalUpload)).toBe(true);
  const afterFacts = {
    ...awardFrom(AWARD_REQUEST),
    vestedShares: '50',
    issuedShares: '20',
    availableShares: '20',
    endedUnvestedShares: '30',
    endedVestedShares: '10',
    unvestedRemainingShares: '20',
    remainingUnissuedShares: '40',
  };
  expect(hasValidRegisterAwardTotals(afterFacts)).toBe(true);
  expect(isRecordedRegisterAward(afterFacts, AWARD_REQUEST, APPOINTMENT.company)).toBe(true);
  const afterReversal = { ...afterFacts, vestedShares: '40', availableShares: '10', unvestedRemainingShares: '30' };
  expect(hasValidRegisterAwardTotals(afterReversal)).toBe(true);
  expect(isRecordedRegisterAward(afterReversal, AWARD_REQUEST, APPOINTMENT.company)).toBe(true);
  expect(afterReversal.issuedShares).toBe('20');
  expect(hasValidRegisterAwardTotals(MEMBER_RECORD.awards[0]!)).toBe(true);
  for (const changed of [
    { vestedShares: '19' },
    { availableShares: '40' },
    { endedUnvestedShares: '51' },
    { endedVestedShares: '31' },
    { unvestedRemainingShares: '21' },
    { remainingUnissuedShares: '41' },
    { endedUnvestedShares: undefined },
    { endedVestedShares: '-1' },
    { vestedShares: '1.5' },
    { shares: (2n ** 256n).toString() },
  ])
    expect(hasValidRegisterAwardTotals({ ...afterFacts, ...changed } as typeof afterFacts)).toBe(false);
  const endRequest: RegisterAwardEndPreparation = {
    operationId: 'end-a',
    appointment: APPOINTMENT.uuid,
    award: AWARD_REQUEST.operationId,
    unvestedShares: '30',
    vestedShares: '10',
    companyEventOn: '2026-10-18',
    reason: 'Company decision ending only unissued rights',
    evidence: 'end-evidence',
  };
  const ended = endFrom(endRequest);
  expect(hasValidRegisterAwardEnd(ended)).toBe(true);
  expect(isRecordedRegisterAwardEnd(ended, endRequest, APPOINTMENT.company)).toBe(true);
  expect(isRecordedRegisterAwardEnd(ended, endRequest, APPOINTMENT.company, ended.evidenceFingerprint)).toBe(true);
  expect(isRecordedRegisterAwardEnd(ended, endRequest, APPOINTMENT.company, 'b'.repeat(64))).toBe(false);
  expect(isRecordedRegisterAwardEnd(ended, endRequest, 'foreign-company')).toBe(false);
  expect(
    isRecordedRegisterAwardEnd(
      endFrom({ ...endRequest, unvestedShares: '9007199254740993' }),
      { ...endRequest, unvestedShares: '9007199254740993' },
      APPOINTMENT.company,
    ),
  ).toBe(true);
  for (const changed of [
    { uuid: 'other-end' },
    { company: 'foreign-company' },
    { award: 'other-award' },
    { preparingAppointment: 'other-appointment' },
    { unvestedShares: '31' },
    { vestedShares: '11' },
    { companyEventOn: '2026-10-17' },
    { reason: 'Another reason' },
    { evidence: 'another-evidence' },
    { evidenceFingerprint: 'invalid' },
    { providedBy: 'platform' },
  ])
    expect(isRecordedRegisterAwardEnd({ ...ended, ...changed }, endRequest, APPOINTMENT.company)).toBe(false);
  for (const changed of [
    { unvestedShares: '0', vestedShares: '0' },
    { unvestedShares: '-1' },
    { vestedShares: '1.5' },
    { vestedShares: (2n ** 256n).toString() },
    { companyEventOn: '2026-02-30' },
    { reason: '' },
    { reason: 'x'.repeat(1001) },
  ])
    expect(hasValidRegisterAwardEnd({ ...ended, ...changed })).toBe(false);
  const reversalRequest: RegisterAwardVestingReversalPreparation = {
    operationId: 'reversal-a',
    appointment: APPOINTMENT.uuid,
    vesting: event.operationId,
    reversedShares: '9007199254740993',
    companyEventOn: '2026-10-18',
    reason: 'Correct the identified company vesting event',
    evidence: 'reversal-evidence',
  };
  const reversal = vestingReversalFrom(reversalRequest);
  expect(hasValidRegisterAwardVestingReversal(reversal)).toBe(true);
  expect(
    isRecordedRegisterAwardVestingReversal(
      reversal,
      reversalRequest,
      APPOINTMENT.company,
      request.operationId,
      reversal.evidenceFingerprint,
    ),
  ).toBe(true);
  expect(
    isRecordedRegisterAwardVestingReversal(
      reversal,
      reversalRequest,
      APPOINTMENT.company,
      request.operationId,
      'b'.repeat(64),
    ),
  ).toBe(false);
  expect(
    isRecordedRegisterAwardVestingReversal(reversal, reversalRequest, APPOINTMENT.company, request.operationId),
  ).toBe(true);
  expect(isRecordedRegisterAwardVestingReversal(reversal, reversalRequest, APPOINTMENT.company, 'other-award')).toBe(
    false,
  );
  for (const changed of [
    { uuid: 'other-reversal' },
    { company: 'foreign-company' },
    { award: 'other-award' },
    { vesting: 'other-vesting' },
    { preparingAppointment: 'other-appointment' },
    { reversedShares: '1' },
    { companyEventOn: '2026-10-17' },
    { reason: 'Another reason' },
    { evidence: 'another-evidence' },
    { evidenceFingerprint: 'invalid' },
    { providedBy: 'platform' },
  ])
    expect(
      isRecordedRegisterAwardVestingReversal(
        { ...reversal, ...changed },
        reversalRequest,
        APPOINTMENT.company,
        request.operationId,
      ),
    ).toBe(false);
  for (const reversedShares of ['0', '-1', '1.5', (2n ** 256n).toString()])
    expect(hasValidRegisterAwardVestingReversal({ ...reversal, reversedShares })).toBe(false);
  const originalVesting = vestingFrom(event);
  expect(remainingRegisterAwardVesting(originalVesting, [reversal])).toBe('1');
  expect(
    remainingRegisterAwardVesting(originalVesting, [
      reversal,
      { ...reversal, uuid: 'reversal-b', reversedShares: '1' },
    ]),
  ).toBe('0');
  expect(
    remainingRegisterAwardVesting(originalVesting, [
      reversal,
      { ...reversal, uuid: 'reversal-b', reversedShares: '2' },
    ]),
  ).toBeNull();
  expect(remainingRegisterAwardVesting(originalVesting, [reversal, reversal])).toBeNull();
  expect(remainingRegisterAwardVesting(originalVesting, [{ ...reversal, vesting: 'other-source' }])).toBe(event.shares);
  expect(remainingRegisterAwardVesting(originalVesting, [{ ...reversal, reversedShares: '0' }])).toBeNull();
  expect(isRecordedRegisterAwardVesting(originalVesting, event, APPOINTMENT.company)).toBe(true);
  const safeAward: OwnMemberRecord['awards'][number] = {
    ...MEMBER_RECORD.awards[0]!,
    vestedShares: '3',
    issuedShares: '1',
    availableShares: '1',
    endedUnvestedShares: '1',
    endedVestedShares: '1',
    unvestedRemainingShares: '1',
    remainingUnissuedShares: '2',
    vestings: [{ ...MEMBER_RECORD.awards[0]!.vestings[0]!, shares: '4' }],
    ends: [
      {
        uuid: 'safe-end',
        unvestedShares: '1',
        vestedShares: '1',
        companyEventOn: '2026-10-18',
        reason: 'Company decision',
        createdAt: '2026-10-18T00:00:00Z',
      },
    ],
    vestingReversals: [
      {
        uuid: 'safe-reversal',
        vesting: MEMBER_RECORD.awards[0]!.vestings[0]!.uuid,
        reversedShares: '1',
        companyEventOn: '2026-10-18',
        reason: 'Company correction',
        createdAt: '2026-10-18T00:00:00Z',
      },
    ],
  };
  const get = jest.fn();
  const api = { get } as unknown as AxiosInstance;
  const record = { ...MEMBER_RECORD, awards: [safeAward] };
  get.mockResolvedValue({ data: record });
  await expect(getOwnMemberRecord(api, record.uuid)).resolves.toMatchObject({ data: record });
  get.mockResolvedValue({ data: { results: [record], next: null } });
  await expect(getOwnMemberRecords(api)).resolves.toMatchObject({ data: { results: [record] } });
  for (const changed of [
    { availableShares: '2' },
    { ends: undefined },
    { vestingReversals: null },
    { vestings: undefined },
    { ends: [] },
    { vestingReversals: [] },
    { vestings: [safeAward.vestings[0]!, safeAward.vestings[0]!] },
    { ends: [safeAward.ends[0]!, safeAward.ends[0]!] },
    { ends: [{ ...safeAward.ends[0]!, reason: '' }] },
    { ends: [{ ...safeAward.ends[0]!, companyEventOn: '2026-02-30' }] },
    { vestingReversals: [safeAward.vestingReversals[0]!, safeAward.vestingReversals[0]!] },
    { vestingReversals: [{ ...safeAward.vestingReversals[0]!, vesting: 'unknown-source' }] },
    { vestingReversals: [{ ...safeAward.vestingReversals[0]!, reversedShares: '0' }] },
    { vestingReversals: [{ ...safeAward.vestingReversals[0]!, reversedShares: '5' }] },
    { vestingReversals: [{ ...safeAward.vestingReversals[0]!, reversedShares: '1.5' }] },
  ]) {
    const malformed = { ...record, awards: [{ ...safeAward, ...changed }] };
    get.mockResolvedValue({ data: malformed });
    await expect(getOwnMemberRecord(api, record.uuid)).rejects.toThrow(REGISTER_AWARD_COPY.MEMBER_RECORDS_FAILED);
    get.mockResolvedValue({ data: { results: [malformed], next: null } });
    await expect(getOwnMemberRecords(api)).rejects.toThrow(REGISTER_AWARD_COPY.MEMBER_RECORDS_FAILED);
  }
  get.mockResolvedValue({ data: { ...MEMBER_RECORD, awards: [] } });
  await expect(getOwnMemberRecord(api, record.uuid)).resolves.toMatchObject({ data: { awards: [] } });
});

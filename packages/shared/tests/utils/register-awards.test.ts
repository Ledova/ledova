import { hasValidRegisterAwardTotals, isRecordedRegisterAward, isRecordedRegisterAwardVesting } from '../../src';
import { APPOINTMENT, AWARD_REQUEST, awardFrom, vestingFrom } from '../fixtures/employee-awards';

it('confirms exact bound receipts and rejects foreign or impossible award quantities beyond safe integer precision', () => {
  const request = { ...AWARD_REQUEST, shares: '9007199254740995' };
  const award = {
    ...awardFrom(request),
    vestedShares: '9007199254740994',
    issuedShares: '9007199254740993',
    availableShares: '1',
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
});

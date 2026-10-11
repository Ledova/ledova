import { allotmentAud, isPreparedRegisterAllotment, isRegisterAllotmentDecisionReceipt } from '../../src';
import { APPOINTMENT } from '../fixtures/employee-awards';
import { ALLOTMENT_REQUEST, allotmentFrom, allotmentDecision, allotmentPreview } from '../fixtures/external-allotments';

it('requires exact fully paid AUD sources and the actual applied ISSUE receipt', () => {
  const row = allotmentFrom(ALLOTMENT_REQUEST);
  expect(allotmentAud('250')).toBe('250.00');
  expect(allotmentAud('0.001')).toBeNull();
  expect(allotmentAud('0')).toBeNull();
  expect(isPreparedRegisterAllotment(row, ALLOTMENT_REQUEST, APPOINTMENT.company)).toBe(true);
  expect(
    isPreparedRegisterAllotment(
      { ...row, contribution: { ...row.contribution, amount: '249.99' } },
      ALLOTMENT_REQUEST,
      APPOINTMENT.company,
    ),
  ).toBe(false);
  expect(
    isPreparedRegisterAllotment(
      { ...row, contribution: { ...row.contribution, companyRecorded: false } },
      ALLOTMENT_REQUEST,
      APPOINTMENT.company,
    ),
  ).toBe(false);
  const request = {
    appointment: APPOINTMENT.uuid,
    kind: 'apply' as const,
    previewDigest: 'b'.repeat(64),
    idempotencyKey: 'apply-a',
    confirmation: true,
  };
  const applied = allotmentDecision(row, request);
  const preview = allotmentPreview(row, true);
  expect(isRegisterAllotmentDecisionReceipt(applied, row.uuid, request, preview)).toBe(true);
  expect(
    isRegisterAllotmentDecisionReceipt(
      { ...applied, agreement: { ...applied.agreement, terms: 'Changed terms' } },
      row.uuid,
      request,
      preview,
    ),
  ).toBe(false);
  expect(isRegisterAllotmentDecisionReceipt({ ...applied, registerEntry: null }, row.uuid, request, preview)).toBe(
    false,
  );
});

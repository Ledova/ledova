import type { AxiosInstance } from 'axios';
import {
  allotmentAud,
  allotmentOwnershipImpact,
  isPreparedRegisterAllotment,
  isRegisterAllotmentDecisionReceipt,
  previewRegisterAllotmentDecision,
  REGISTER_ALLOTMENT_COPY,
  type RegisterAllotmentDecisionPreview,
} from '../../src';
import { APPOINTMENT } from '../fixtures/employee-awards';
import { ALLOTMENT_REQUEST, allotmentFrom, allotmentDecision, allotmentPreview } from '../fixtures/external-allotments';

it('requires exact fully paid AUD sources and the actual applied ISSUE receipt', async () => {
  const row = allotmentFrom(ALLOTMENT_REQUEST);
  expect(allotmentAud('250')).toBe('250.00');
  expect(allotmentAud('0.001')).toBeNull();
  expect(allotmentAud('0')).toBeNull();
  expect(isPreparedRegisterAllotment(row, ALLOTMENT_REQUEST, APPOINTMENT.company)).toBe(true);
  expect(
    isPreparedRegisterAllotment(
      { ...row, status: 'applied', registerEntry: 'entry-a', effectiveOn: '2026-10-18' },
      ALLOTMENT_REQUEST,
      APPOINTMENT.company,
    ),
  ).toBe(false);
  expect(
    isPreparedRegisterAllotment({ ...row, companyEventOn: '2020-01-01' }, ALLOTMENT_REQUEST, APPOINTMENT.company),
  ).toBe(false);
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
  const preview = allotmentPreview(row);
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
  const completion = {
    ...request,
    kind: 'approve' as const,
    completeIssue: true,
    applyAppointment: 'application-appointment',
    idempotencyKey: 'completion-a',
  };
  const completionPreview = { ...preview, completeIssue: true, applyAppointment: completion.applyAppointment };
  const completed = allotmentDecision(row, completion);
  expect(completed.decisions).toHaveLength(2);
  expect(isRegisterAllotmentDecisionReceipt(completed, row.uuid, completion, completionPreview)).toBe(true);
  expect(isRegisterAllotmentDecisionReceipt(completed, row.uuid, completion, preview)).toBe(false);
  expect(isRegisterAllotmentDecisionReceipt(applied, row.uuid, completion, completionPreview)).toBe(false);
  expect(
    isRegisterAllotmentDecisionReceipt({ ...completed, registerEntry: null }, row.uuid, completion, completionPreview),
  ).toBe(false);
  expect(
    isRegisterAllotmentDecisionReceipt(
      completed,
      row.uuid,
      { ...completion, appointment: 'another-approver' },
      completionPreview,
    ),
  ).toBe(false);
  const approved = allotmentDecision(row, { ...request, kind: 'approve', idempotencyKey: 'prior-approval' });
  expect(allotmentDecision(approved, completion).decisions).toHaveLength(2);
  const investment: RegisterAllotmentDecisionPreview = {
    ...preview,
    shares: '2500',
    consideration: '1000000.00',
    issuedSupply: '10000',
    afterIssuedSupply: '12500',
    authorisedSupply: '20000',
    currentShares: '0',
    afterShares: '2500',
    currentHolders: [
      { member: 'founder', name: 'Synthetic Founder', shares: '6000' },
      { member: 'holder-b', name: null, shares: '4000' },
    ],
  };
  const impact = allotmentOwnershipImpact(investment)!;
  expect(impact.consideration).toBe('1000000.00');
  expect(impact.unitPrice).toBe('AUD 400.0000');
  expect([impact.beforeIssuedSupply, impact.afterIssuedSupply]).toEqual(['10000', '12500']);
  expect(impact.rows).toEqual([
    {
      member: row.member,
      name: row.name,
      recipient: true,
      beforeShares: '0',
      afterShares: '2500',
      beforePercentage: '0.00%',
      afterPercentage: '20.00%',
    },
    {
      member: 'founder',
      name: 'Synthetic Founder',
      recipient: false,
      beforeShares: '6000',
      afterShares: '6000',
      beforePercentage: '60.00%',
      afterPercentage: '48.00%',
    },
    {
      member: 'holder-b',
      name: null,
      recipient: false,
      beforeShares: '4000',
      afterShares: '4000',
      beforePercentage: '40.00%',
      afterPercentage: '32.00%',
    },
  ]);
  const topUp = allotmentOwnershipImpact({
    ...investment,
    member: 'founder',
    newMember: false,
    name: 'Synthetic Founder',
    currentShares: '6000',
    afterShares: '8500',
  })!;
  expect(topUp.rows.map((holder) => [holder.member, holder.beforePercentage, holder.afterPercentage])).toEqual([
    ['founder', '60.00%', '68.00%'],
    ['holder-b', '40.00%', '32.00%'],
  ]);
  const repeating = allotmentOwnershipImpact({
    ...investment,
    shares: '3',
    consideration: '1.00',
    issuedSupply: '3',
    afterIssuedSupply: '6',
    afterShares: '3',
    currentHolders: [
      { member: 'founder', name: 'Synthetic Founder', shares: '1' },
      { member: 'holder-b', name: null, shares: '2' },
    ],
  })!;
  expect(repeating.unitPrice).toBe('AUD 0.3333');
  expect(repeating.rows[1]).toMatchObject({ beforePercentage: '33.33%', afterPercentage: '16.67%' });
  const huge = allotmentOwnershipImpact({
    ...investment,
    shares: '9007199254740993',
    consideration: '9007199254740993.00',
    issuedSupply: '9007199254740993',
    afterIssuedSupply: '18014398509481986',
    authorisedSupply: '18014398509481986',
    afterShares: '9007199254740993',
    currentHolders: [{ member: 'founder', name: null, shares: '9007199254740993' }],
  })!;
  expect(huge.unitPrice).toBe('AUD 1.0000');
  expect(huge.rows.map((holder) => [holder.beforeShares, holder.afterShares, holder.afterPercentage])).toEqual([
    ['0', '9007199254740993', '50.00%'],
    ['9007199254740993', '9007199254740993', '50.00%'],
  ]);
  expect(allotmentOwnershipImpact(preview)?.rows[0]).toMatchObject({
    beforePercentage: '—',
    afterPercentage: '100.00%',
  });
  expect(
    allotmentOwnershipImpact({
      ...preview,
      shares: '1000000000',
      consideration: '0.01',
      afterShares: '1000000000',
      afterIssuedSupply: '1000000000',
      authorisedSupply: '1000000000',
    })?.unitPrice,
  ).toBe('< AUD 0.0001');
  expect(
    allotmentOwnershipImpact({
      ...preview,
      shares: '101',
      consideration: '0.01',
      afterShares: '101',
      afterIssuedSupply: '101',
    })?.unitPrice,
  ).toBe('< AUD 0.0001');
  expect(
    allotmentOwnershipImpact({
      ...preview,
      shares: '8',
      consideration: '0.01',
      afterShares: '8',
      afterIssuedSupply: '8',
    })?.unitPrice,
  ).toBe('AUD 0.0013');
  expect(
    allotmentOwnershipImpact({
      ...investment,
      shares: '1',
      issuedSupply: '32',
      afterIssuedSupply: '33',
      afterShares: '1',
      currentHolders: [
        { member: 'founder', name: null, shares: '1' },
        { member: 'holder-b', name: null, shares: '31' },
      ],
    })?.rows[1]?.beforePercentage,
  ).toBe('3.13%');
  for (const changed of [
    { currency: 'USD' },
    { shares: '1.5' },
    { shares: '0' },
    { shares: `1${'0'.repeat(78)}` },
    { consideration: '0.001' },
    { consideration: '0' },
    { issuedSupply: '9999' },
    { authorisedSupply: '12499' },
    { afterIssuedSupply: '12501' },
    { currentShares: '1' },
    { afterShares: '2501' },
    { classCode: '' },
    { currentHolders: undefined },
    { currentHolders: [...investment.currentHolders, investment.currentHolders[0]!] },
    { currentHolders: [{ member: 'founder', name: null, shares: '0' }] },
    { currentHolders: [{ member: 'founder', name: null, shares: '-1' }] },
    { currentHolders: [{ member: 'founder', name: null, shares: '10001' }] },
    { unmetRequirements: ['allotment_decided'] },
    { status: 'applied' },
    { registerEntry: 'entry-a' },
  ])
    expect(allotmentOwnershipImpact({ ...investment, ...changed } as RegisterAllotmentDecisionPreview)).toBeNull();
  expect(
    allotmentOwnershipImpact({
      ...investment,
      shares: '1',
      issuedSupply: (2n ** 256n - 1n).toString(),
      afterIssuedSupply: (2n ** 256n).toString(),
      authorisedSupply: (2n ** 256n).toString(),
      afterShares: '1',
      currentHolders: [{ member: 'founder', name: null, shares: (2n ** 256n - 1n).toString() }],
    }),
  ).toBeNull();
  const malformed = { ...investment, afterIssuedSupply: '12501' };
  const response = { data: malformed };
  const api = { post: jest.fn().mockResolvedValue(response) } as unknown as AxiosInstance;
  const decision = { appointment: APPOINTMENT.uuid, kind: 'apply' as const };
  await expect(previewRegisterAllotmentDecision(api, row.uuid, decision)).rejects.toThrow(
    REGISTER_ALLOTMENT_COPY.OWNERSHIP_UNAVAILABLE,
  );
  await expect(previewRegisterAllotmentDecision(api, row.uuid, { ...decision, kind: 'approve' })).rejects.toThrow(
    REGISTER_ALLOTMENT_COPY.OWNERSHIP_UNAVAILABLE,
  );
  await expect(previewRegisterAllotmentDecision(api, row.uuid, { ...decision, kind: 'reject' })).resolves.toBe(
    response,
  );
  response.data = { ...malformed, canDecide: false };
  await expect(previewRegisterAllotmentDecision(api, row.uuid, decision)).resolves.toBe(response);
  response.data = investment;
  await expect(previewRegisterAllotmentDecision(api, row.uuid, decision)).resolves.toBe(response);
  const completionRequest = { ...decision, kind: 'approve' as const, completeIssue: true };
  await expect(previewRegisterAllotmentDecision(api, row.uuid, completionRequest)).rejects.toThrow(
    REGISTER_ALLOTMENT_COPY.PREVIEW_FAILED,
  );
  response.data = { ...investment, completeIssue: true, applyAppointment: decision.appointment };
  await expect(previewRegisterAllotmentDecision(api, row.uuid, completionRequest)).resolves.toBe(response);
  response.data = { ...investment, completeIssue: true, applyAppointment: 'different-appointment' };
  await expect(previewRegisterAllotmentDecision(api, row.uuid, completionRequest)).rejects.toThrow(
    REGISTER_ALLOTMENT_COPY.PREVIEW_FAILED,
  );
});

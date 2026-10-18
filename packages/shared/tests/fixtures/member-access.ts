import type { OwnMemberRecord } from '../../src/types';

export const MEMBER_RECORD: OwnMemberRecord = {
  uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  member: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  company: { uuid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Synthetic Member Company', acn: '123456789' },
  name: 'Company Recorded Member',
  residentialAddress: 'Synthetic company-recorded address',
  identitySource: 'company_recorded',
  classes: [
    {
      uuid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      name: 'Ordinary',
      symbol: 'ORD',
      shares: '10',
      enteredOn: '2026-10-01',
      ceasedOn: null,
      amountPaid: '20.00',
    },
  ],
  awards: [
    {
      uuid: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      token: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      shares: '5',
      termsOn: '2026-10-01',
      terms: 'Synthetic award terms',
      schedule: 'Company-recorded vesting only',
      vestedShares: '2',
      issuedShares: '0',
      availableShares: '2',
      vestings: [{ uuid: 'ffffffff-ffff-4fff-8fff-ffffffffffff', shares: '2', vestedOn: '2026-10-02' }],
    },
  ],
};

export const MEMBER_ENTRY = {
  uuid: '11111111-1111-4111-8111-111111111111',
  sequence: 1,
  kind: 'ISSUE',
  companyEventOn: null,
  effectiveOn: '2026-10-01',
  delta: '10',
  createdAt: '2026-10-01T00:00:00Z',
  corrects: null,
  correctedBy: null,
};
export const MEMBER_CODE = 'A'.repeat(43);

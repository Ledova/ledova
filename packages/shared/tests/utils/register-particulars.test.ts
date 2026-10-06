import type { RegisterParticularsChange, RegisterParticularsChangePreparation } from '../../src/types';
import { isPreparedRegisterParticularsChange } from '../../src/utils/register-particulars';

const PREPARATION: RegisterParticularsChangePreparation = {
  operationId: 'change-a',
  appointment: 'appointment-a',
  member: 'member-a',
  supportingEvidence: 'supporting-a',
  name: 'Synthetic Member Renamed',
  residentialAddress: '8 Synthetic Street, Melbourne VIC 3000',
  asAt: '2026-09-20',
  reason: 'The member changed their name by deed poll and moved',
};

function change(overrides: Partial<RegisterParticularsChange> = {}): RegisterParticularsChange {
  return {
    uuid: 'change-a',
    company: 'company-a',
    member: 'member-a',
    name: 'Synthetic Member Renamed',
    residentialAddress: '8 Synthetic Street, Melbourne VIC 3000',
    asAt: '2026-09-20',
    reason: 'The member changed their name by deed poll and moved',
    evidenceFingerprint: 'e'.repeat(64),
    evidenceSnapshot: {},
    supportingEvidence: 'supporting-a',
    preparingAppointment: 'appointment-a',
    preparedByName: 'Synthetic Preparer',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    createdAt: '2026-10-06T00:00:00Z',
    ...overrides,
  };
}

it('accepts a prepared change that carries exactly the request', () => {
  expect(isPreparedRegisterParticularsChange(change(), PREPARATION)).toBe(true);
});

it.each<[string, Partial<RegisterParticularsChange>]>([
  ['operation', { uuid: 'change-b' }],
  ['preparing appointment', { preparingAppointment: 'appointment-b' }],
  ['member', { member: 'member-b' }],
  ['supporting document', { supportingEvidence: 'supporting-b' }],
  ['name', { name: 'Another Name' }],
  ['residential address', { residentialAddress: '9 Synthetic Street, Melbourne VIC 3000' }],
  ['as-at date', { asAt: '2026-09-21' }],
  ['reason', { reason: 'Another reason' }],
  ['provider', { providedBy: 'staff_verified' }],
])('refuses a prepared change with another %s', (_field, other) => {
  expect(isPreparedRegisterParticularsChange(change(other), PREPARATION)).toBe(false);
});

import type { OwnCompanyAppointment, RegisterDiscrepancy, RegisterReconciliation } from '../../src/types';
import {
  appointmentForAcknowledgement,
  isDiscrepancyAcknowledgementReceipt,
} from '../../src/utils/register-reconciliations';

function appointment(uuid: string, overrides: Partial<OwnCompanyAppointment> = {}): OwnCompanyAppointment {
  return {
    uuid,
    company: 'company-a',
    companyName: 'Synthetic Pty Ltd',
    capabilities: ['approve'],
    delegatableCapabilities: [],
    createdAt: '2026-10-01T00:00:00Z',
    declarationText: null,
    declarationVersion: null,
    expiresAt: null,
    isEffective: true,
    revokedAt: null,
    source: 'invitation',
    status: 'active',
    ...overrides,
  };
}

it.each<[OwnCompanyAppointment['capabilities'][number], boolean]>([
  ['admin', true],
  ['approve', true],
  ['prepare', false],
  ['apply', false],
  ['read_register', false],
  ['finance', false],
])('lets an appointment holding %s acknowledge: %s', (capability, acknowledges) => {
  const found = appointmentForAcknowledgement([appointment('a', { capabilities: [capability] })], 'company-a');
  expect(found?.uuid === 'a').toBe(acknowledges);
});

it("counts only a current appointment of the reconciliation's company", () => {
  for (const overrides of [
    { company: 'company-b' },
    { isEffective: false },
    { status: 'revoked' as const },
    { expiresAt: '2020-01-01T00:00:00Z' },
  ])
    expect(appointmentForAcknowledgement([appointment('a', overrides)], 'company-a')).toBeUndefined();
});

const REQUEST = {
  appointment: 'appointment-a',
  discrepancy: 1,
  reason: 'The directors accept the outside transfer',
  idempotencyKey: 'key-a',
};

function row(acknowledgement: RegisterDiscrepancy['acknowledgement']): RegisterDiscrepancy {
  return {
    kind: 'unrecognised_transfer',
    transaction: '0xabc',
    block: 12,
    acknowledgeable: !acknowledgement,
    acknowledgement,
  };
}

const ACKNOWLEDGEMENT = {
  reason: REQUEST.reason,
  appointment: 'appointment-a',
  acknowledgedByName: 'Synthetic Approver',
  acknowledgedAt: '2026-10-05T00:00:00Z',
  providedBy: 'company',
};

function reconciliation(
  acknowledgement: RegisterDiscrepancy['acknowledgement'] = ACKNOWLEDGEMENT,
  uuid = 'reconciliation-a',
): RegisterReconciliation {
  return {
    uuid,
    token: 'class-a',
    status: 'discrepant',
    blockNumber: 12,
    blockHash: '0x' + 'a'.repeat(64),
    registerSequence: 3,
    failure: '',
    createdAt: '2026-10-05T00:00:00Z',
    latest: true,
    discrepancies: [row(null), row(acknowledgement)],
  };
}

it('accepts the row named by its position, acknowledged with the reason by this appointment for the company', () => {
  expect(isDiscrepancyAcknowledgementReceipt(reconciliation(), 'reconciliation-a', REQUEST)).toBe(true);
});

it.each<[string, RegisterReconciliation, typeof REQUEST]>([
  ['another reconciliation', reconciliation(ACKNOWLEDGEMENT, 'reconciliation-b'), REQUEST],
  ['the row left unacknowledged', reconciliation(null), REQUEST],
  ['another row', reconciliation(), { ...REQUEST, discrepancy: 0 }],
  ['a position beyond the rows', reconciliation(), { ...REQUEST, discrepancy: 2 }],
  ['another reason', reconciliation({ ...ACKNOWLEDGEMENT, reason: 'Another reason' }), REQUEST],
  ['another appointment', reconciliation({ ...ACKNOWLEDGEMENT, appointment: 'appointment-b' }), REQUEST],
  [
    'a staff-era acknowledgement',
    reconciliation({ ...ACKNOWLEDGEMENT, appointment: null, providedBy: 'staff' }),
    REQUEST,
  ],
  ['staff named as the provider', reconciliation({ ...ACKNOWLEDGEMENT, providedBy: 'staff' }), REQUEST],
])('refuses a receipt with %s', (_case, received, request) => {
  expect(isDiscrepancyAcknowledgementReceipt(received, 'reconciliation-a', request)).toBe(false);
});

import axios from 'axios';
import { REGISTER_RECONCILIATION_COPY } from '../../src/constants/business/register-reconciliations';
import {
  acknowledgeRegisterDiscrepancy,
  getRegisterReconciliation,
  getRegisterReconciliations,
} from '../../src/services/register-reconciliations';

const SESSION = { timeout: 1000, ledovaSessionEpoch: 3 };
const ACKNOWLEDGED = {
  kind: 'unrecognised_transfer',
  transaction: '0xabc',
  block: 12,
  acknowledgeable: false,
  acknowledgement: {
    reason: 'The directors accept the outside transfer',
    appointment: 'appointment-a',
    acknowledgedByName: 'Synthetic Approver',
    acknowledgedAt: '2026-10-05T00:00:00Z',
    providedBy: 'company',
  },
};
const OPEN = {
  kind: 'member',
  member: 'member-a',
  chain: '10',
  expected: '5',
  acknowledgeable: true,
  acknowledgement: null,
};
const STAFF_ERA = {
  kind: 'supply',
  chain: '105',
  expected: '100',
  acknowledgeable: false,
  acknowledgement: {
    ...ACKNOWLEDGED.acknowledgement,
    appointment: null,
    acknowledgedByName: null,
    providedBy: 'staff',
  },
};
const RECORD = { uuid: 'reconciliation-a', discrepancies: [ACKNOWLEDGED, OPEN, STAFF_ERA] };

afterEach(() => jest.restoreAllMocks());

it('lists, reads and acknowledges through the reconciliation routes', async () => {
  const api = axios.create();
  const get = jest
    .spyOn(api, 'get')
    .mockResolvedValueOnce({ data: { results: [] } })
    .mockResolvedValueOnce({ data: RECORD });
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: RECORD });
  const request = { appointment: 'appointment-a', discrepancy: 1, reason: 'Accepted', idempotencyKey: 'key-a' };
  await getRegisterReconciliations(api, { company: 'company-a', token: 'class-a', page: 2 }, SESSION);
  await getRegisterReconciliation(api, 'reconciliation-a');
  await acknowledgeRegisterDiscrepancy(api, 'reconciliation-a', request, SESSION);
  expect(get.mock.calls).toEqual([
    [
      '/api/v1/tokens/register-reconciliations/',
      { ...SESSION, params: { company: 'company-a', token: 'class-a', page: 2 } },
    ],
    ['/api/v1/tokens/register-reconciliations/reconciliation-a/', {}],
  ]);
  expect(post.mock.calls).toEqual([
    ['/api/v1/tokens/register-reconciliations/reconciliation-a/acknowledge/', request, SESSION],
  ]);
});

it('checks the discrepancies of every reconciliation read and refuses rows it cannot read', async () => {
  const api = axios.create();
  jest
    .spyOn(api, 'get')
    .mockResolvedValueOnce({ data: { results: [RECORD], next: null } })
    .mockResolvedValueOnce({ data: RECORD });
  jest.spyOn(api, 'post').mockResolvedValueOnce({ data: RECORD });
  expect((await getRegisterReconciliations(api)).data.results).toEqual([RECORD]);
  expect((await getRegisterReconciliation(api, 'reconciliation-a')).data).toEqual(RECORD);
  expect((await acknowledgeRegisterDiscrepancy(api, 'reconciliation-a', {} as never)).data).toEqual(RECORD);
  for (const discrepancies of [
    undefined,
    null,
    {},
    [null],
    [{ ...OPEN, kind: 7 }],
    [{ ...OPEN, acknowledgeable: 'yes' }],
    [{ ...OPEN, block: '12' }],
    [{ ...OPEN, chain: 10 }],
    [{ ...OPEN, detail: null }],
    [{ ...OPEN, acknowledgement: undefined }],
    [{ ...OPEN, acknowledgement: 'acknowledged' }],
    [{ ...ACKNOWLEDGED, acknowledgement: { ...ACKNOWLEDGED.acknowledgement, reason: null } }],
    [{ ...ACKNOWLEDGED, acknowledgement: { ...ACKNOWLEDGED.acknowledgement, appointment: 7 } }],
    [{ ...ACKNOWLEDGED, acknowledgement: { ...ACKNOWLEDGED.acknowledgement, acknowledgedByName: undefined } }],
  ]) {
    jest.spyOn(api, 'post').mockResolvedValueOnce({ data: { ...RECORD, discrepancies } });
    await expect(acknowledgeRegisterDiscrepancy(api, 'reconciliation-a', {} as never)).rejects.toThrow(
      REGISTER_RECONCILIATION_COPY.UNREADABLE,
    );
  }
  jest.spyOn(api, 'get').mockResolvedValueOnce({ data: { ...RECORD, discrepancies: [{ kind: 'supply' }] } });
  await expect(getRegisterReconciliation(api, 'reconciliation-a')).rejects.toThrow(
    REGISTER_RECONCILIATION_COPY.UNREADABLE,
  );
  jest.spyOn(api, 'get').mockResolvedValueOnce({ data: { results: [{ ...RECORD, discrepancies: null }], next: null } });
  await expect(getRegisterReconciliations(api)).rejects.toThrow(REGISTER_RECONCILIATION_COPY.UNREADABLE);
});

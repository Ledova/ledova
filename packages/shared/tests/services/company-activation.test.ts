import axios from 'axios';
import { activateCompany } from '../../src/services/companies';
import { companyActivationOutcome } from '../../src/constants/business/company-activation';
import { canAdministerCompany, canPersonallyAdministerCompany } from '../../src/hooks/useCompanySelection';
import type { CompanyActivationAttempt, CompanyListItem } from '../../src/types';

const request = {
  idempotencyKey: '70000000-0000-4000-8000-000000000001',
  appointment: '80000000-0000-4000-8000-000000000001',
  lifecycleRevision: 2,
  declarationVersion: '2026-10-04',
  acceptDeclaration: true,
};
afterEach(() => jest.restoreAllMocks());

it('carries the exact chosen appointment, request key and session guard to the company activation action', async () => {
  const api = axios.create();
  const refusal = {
    status: 200,
    data: { company: { status: 'draft' }, attempt: { status: 'failed', reason: 'unconfigured' } },
  };
  const post = jest.spyOn(api, 'post').mockResolvedValue(refusal);
  const config = { ledovaSessionEpoch: 3, ledovaSubmissionGuard: jest.fn() };
  expect(await activateCompany(api, 'company-a', request, config)).toBe(refusal);
  expect(post).toHaveBeenCalledWith('/api/v1/companies/company-a/activate/', request, config);
  expect(request).not.toHaveProperty('actor');
});

it('preserves basic draft administration while requiring personal admin for activation', () => {
  const draft = {
    status: 'draft',
    isOwner: true,
    administrativeAccess: { capabilities: [], draftSetup: true },
  } as unknown as CompanyListItem;
  expect(canAdministerCompany(draft)).toBe(true);
  expect(canPersonallyAdministerCompany(draft)).toBe(false);
  expect(
    canPersonallyAdministerCompany({
      ...draft,
      isOwner: false,
      administrativeAccess: { capabilities: ['admin'], draftSetup: false },
    }),
  ).toBe(true);
  expect(
    canPersonallyAdministerCompany({
      ...draft,
      administrativeAccess: { capabilities: ['admin', 'admin'], draftSetup: false },
    }),
  ).toBe(false);
});

it.each([
  ['pending', 'unavailable', null, 'pending. No activation was applied.'],
  ['failed', 'unconfigured', null, 'No activation was applied. The ABR lookup is not configured.'],
  ['passed', 'matched', null, 'No activation was applied.'],
  ['passed', 'matched', '2026-10-05', 'Activation was applied.'],
] as const)('describes %s lookup status from the admitted effect marker', (status, reason, appliedAt, text) => {
  expect(companyActivationOutcome({ status, reason, appliedAt } as CompanyActivationAttempt)).toContain(text);
});

import { cleanup, renderHook } from '@testing-library/react-native';
import { canOpen, type AccountRole } from '@ledova/shared';
import { useRole } from './useRole';

let mockAccount: { role: AccountRole } | null = null;
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => ({ userAccount: mockAccount, isLoading: false }),
}));

afterEach(async () => {
  await cleanup();
});

async function roleOf(account: { role: AccountRole } | null) {
  mockAccount = account;
  const { result } = await renderHook(() => useRole());
  return result.current;
}

it.each([
  ['investor', true, false],
  ['company', false, true],
  ['both', true, true],
] as const)('decides a %s account with the shared page rule', async (role, isInvestor, isCompany) => {
  const decided = await roleOf({ role });

  expect(decided).toEqual({ role, isInvestor, isCompany, isLoading: false });
  expect(decided.isInvestor).toBe(canOpen(role, 'investing'));
  expect(decided.isCompany).toBe(canOpen(role, 'company'));
});

it('treats an account it has not read as an investor, as the web does', async () => {
  expect(await roleOf(null)).toEqual({ role: 'investor', isInvestor: true, isCompany: false, isLoading: false });
});

it.each(['', 'staff', 'toString'])(
  'offers neither investing nor company screens to a role the API does not define (%p)',
  async (role) => {
    expect(await roleOf({ role: role as AccountRole })).toMatchObject({ isInvestor: false, isCompany: false });
  },
);

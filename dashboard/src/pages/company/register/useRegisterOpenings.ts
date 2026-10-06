import { useQuery } from '@tanstack/react-query';
import {
  REGISTER_OPENING_COPY,
  getRegisterOpeningHolders,
  getRegisterOpenings,
  readEveryPage,
  type OrderSubmissionOwner,
  type RegisterOpeningBoundary,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from './useCompanyRegister';
import { firstOfEach } from './useRegisterCorrections';

type Holding = { address: string; shares: string };

const WHOLE = /^\d+$/;

export function openingsKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'openings', token];
}

export function openingHoldersKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'holders', 'opening', token];
}

function whole(holdings: Holding[]) {
  return holdings.every(({ shares }) => WHOLE.test(shares));
}

function largestFirst(left: Holding, right: Holding) {
  const difference = BigInt(right.shares) - BigInt(left.shares);
  if (difference !== 0n) return difference > 0n ? 1 : -1;
  const [first, second] = [left.address.toLowerCase(), right.address.toLowerCase()];
  return first < second ? -1 : first > second ? 1 : 0;
}

export function useRegisterOpenings(owner: OrderSubmissionOwner, token: string, guard: () => void) {
  return useQuery({
    queryKey: openingsKey(owner, token),
    queryFn: async () => {
      const openings = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterOpenings(apiClient, { token, page }, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      });
      if (openings.some((proposal) => proposal.token !== token || !whole(proposal.boundarySummary?.holdings ?? [])))
        throw new Error('The openings did not state exact holdings of this share class.');
      return firstOfEach(openings, ({ uuid }) => uuid).sort(
        (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
      );
    },
    ...READ_TIMING,
  });
}

export async function readOpeningHolders(token: string, guard: () => void) {
  guard();
  const { data } = await getRegisterOpeningHolders(apiClient, token, { ledovaSubmissionGuard: guard });
  guard();
  if (!whole(data.holdings)) throw new Error('The chain holdings did not state exact share counts.');
  return data;
}

export function openingHoldings(summary: RegisterOpeningBoundary) {
  const rows = [...summary.holdings].sort(largestFirst);
  const names = new Map<string, string>();
  let fresh = 0;
  for (const { member, memberName } of rows) {
    if (member === null || names.has(member)) continue;
    names.set(member, memberName ?? REGISTER_OPENING_COPY.NEW_MEMBER_NUMBERED(++fresh));
  }
  return {
    names,
    holdings: rows.map(({ address, shares, member }) => ({
      address,
      shares,
      name: (member !== null && names.get(member)) || REGISTER_OPENING_COPY.NEW_MEMBER,
    })),
  };
}

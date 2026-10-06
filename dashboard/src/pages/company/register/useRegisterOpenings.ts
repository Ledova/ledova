import { getRegisterOpeningHolders, type OrderSubmissionOwner } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { registerKey } from './useCompanyRegister';

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

export async function readOpeningHolders(token: string, guard: () => void) {
  guard();
  const { data } = await getRegisterOpeningHolders(apiClient, token, { ledovaSubmissionGuard: guard });
  guard();
  if (!whole(data.holdings)) throw new Error('The chain holdings did not state exact share counts.');
  return data;
}

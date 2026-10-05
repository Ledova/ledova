import {
  assertNextPageAdvances,
  getNextPageParam,
  getRegisterEntries,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { registerKey } from './useCompanyRegister';

export function entriesKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'entries', token];
}

export function correctionsKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'corrections', token];
}

async function guarded<Result>(guard: () => void, read: () => Promise<Result>) {
  guard();
  const result = await read();
  guard();
  return result;
}

function readEntries(token: string, page: number, guard: () => void) {
  return guarded(guard, () => getRegisterEntries(apiClient, token, { page }, { ledovaSubmissionGuard: guard }));
}

export async function readClassEntry(token: string, uuid: string, guard: () => void) {
  let page: number | undefined = 1;
  while (page !== undefined) {
    const { data } = await readEntries(token, page, guard);
    const entry = data.results.find((row) => row.uuid === uuid);
    if (entry) {
      if (!entry.changes.every(({ shares }) => /^-?\d+$/.test(shares)))
        throw new Error('The register entry did not state exact share changes.');
      return entry;
    }
    assertNextPageAdvances(page, data);
    page = getNextPageParam(data);
  }
  return null;
}

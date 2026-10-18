import { useQuery } from '@tanstack/react-query';
import {
  getRegisterCorrections,
  readEveryPage,
  type OrderSubmissionOwner,
  type RegisterCorrection,
  type RegisterEntry,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';
import { firstOfEach, guarded } from './registerReads';
import { readNamedEntries } from './useRegisterEntries';

export type ClassCorrection = { proposal: RegisterCorrection; entry: RegisterEntry };

export function correctionsKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'corrections', token];
}

async function readCorrectionPage(token: string, page: number, guard: () => void) {
  const { data } = await guarded(guard, () =>
    getRegisterCorrections(apiClient, { token, page }, { ledovaSubmissionGuard: guard }),
  );
  const corrected = await readNamedEntries(token, [...new Set(data.results.map(({ corrects }) => corrects))], guard);
  return {
    data: {
      ...data,
      results: data.results.map((proposal): ClassCorrection => {
        const entry = corrected.get(proposal.corrects);
        if (!entry) throw new Error('The corrections named an entry outside this share class.');
        return { proposal, entry };
      }),
    },
  };
}

export function useClassCorrections(owner: OrderSubmissionOwner, token: string, guard: () => void) {
  return useQuery({
    queryKey: correctionsKey(owner, token),
    queryFn: async () =>
      firstOfEach(
        await readEveryPage((page) => readCorrectionPage(token, page, guard)),
        ({ proposal }) => proposal.uuid,
      ).sort((left, right) => Date.parse(right.proposal.createdAt) - Date.parse(left.proposal.createdAt)),
    ...READ_TIMING,
  });
}

import { useQuery } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { READ_TIMING } from '../constants/api';
import { getRegisterCorrections } from '../services/register-corrections';
import type { RegisterCorrection, RegisterEntry } from '../types';
import { firstOfEach, readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { registerKey } from './useCompanyOwnership';
import { guarded, readNamedEntries } from './useRegisterEntries';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export type ClassCorrection = { proposal: RegisterCorrection; entry: RegisterEntry };

export function correctionsKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'corrections', token];
}

async function readCorrectionPage(
  apiClient: AxiosInstance,
  token: string,
  page: number,
  guard: () => void,
  session?: OrderSubmissionSession,
) {
  const { data } = await guarded(guard, () =>
    getRegisterCorrections(apiClient, { token, page }, { ...session?.requestConfig(), ledovaSubmissionGuard: guard }),
  );
  const corrected = await readNamedEntries(
    apiClient,
    token,
    [...new Set(data.results.map(({ corrects }) => corrects))],
    guard,
    session,
  );
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

export function useClassCorrections(
  owner: OrderSubmissionOwner,
  token: string,
  guard: () => void,
  enabled = true,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: correctionsKey(owner, token),
    enabled,
    queryFn: async () =>
      firstOfEach(
        await readEveryPage((page) => readCorrectionPage(apiClient, token, page, guard, session)),
        ({ proposal }) => proposal.uuid,
      ).sort((left, right) => Date.parse(right.proposal.createdAt) - Date.parse(left.proposal.createdAt)),
    ...READ_TIMING,
  });
}

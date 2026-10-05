import { useQuery } from '@tanstack/react-query';
import {
  createUserFriendlyError,
  getOwnCompanyAppointments,
  getRegisterImports,
  readEveryPage,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { ownAppointmentsKey } from '../team/appointments';
import { READ_TIMING, registerKey } from './useCompanyRegister';

export const ACCOUNT_CHANGED = 'Your signed-in account changed. Reopen the register.';

export function ownerGuard(owner: OrderSubmissionOwner, currentOwner: () => OrderSubmissionOwner | null) {
  return () => {
    if (currentOwner() !== owner) throw createUserFriendlyError(ACCOUNT_CHANGED);
  };
}

export function importsKey(owner: OrderSubmissionOwner, token: string) {
  return [...registerKey(owner), 'imports', token];
}

export function useRegisterImports(owner: OrderSubmissionOwner, token: string, guard: () => void) {
  return useQuery({
    queryKey: importsKey(owner, token),
    queryFn: async () => {
      const imports = await readEveryPage(async (page) => {
        guard();
        const result = await getRegisterImports(apiClient, { token, page }, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      });
      if (imports.some((proposal) => proposal.token !== token))
        throw new Error('The imports did not identify this share class.');
      return [...imports].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    },
    ...READ_TIMING,
  });
}

export function useOwnAppointments(owner: OrderSubmissionOwner, guard: () => void) {
  return useQuery({
    queryKey: ownAppointmentsKey(owner),
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getOwnCompanyAppointments(apiClient, page, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      }),
    ...READ_TIMING,
  });
}

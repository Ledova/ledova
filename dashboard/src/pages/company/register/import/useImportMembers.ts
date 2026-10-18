import { useQuery } from '@tanstack/react-query';
import { getRegisterTransferMembers, isRegisterImportMembers, type OrderSubmissionOwner } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';

export function importMembersKey(owner: OrderSubmissionOwner, company: string, token: string) {
  return [...registerKey(owner), 'import-members', company, token];
}

export async function readImportMembers(token: string, guard: () => void) {
  guard();
  const { data } = await getRegisterTransferMembers(apiClient, token, { ledovaSubmissionGuard: guard });
  guard();
  if (!isRegisterImportMembers(data))
    throw new Error('The company shareholder and award recipient choices could not be confirmed.');
  return data;
}

export function useImportMembers(
  owner: OrderSubmissionOwner,
  company: string,
  token: string,
  guard: () => void,
  enabled = true,
) {
  return useQuery({
    queryKey: importMembersKey(owner, company, token),
    enabled,
    queryFn: () => readImportMembers(token, guard),
    ...READ_TIMING,
  });
}

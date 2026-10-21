import { useQuery } from '@tanstack/react-query';
import { getRegisterTransferMembers, isRegisterImportMembers, type OrderSubmissionOwner } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING, registerKey } from '@hooks/useRegisterAccess';

export function allPeopleKey(owner: OrderSubmissionOwner) {
  return [...registerKey(owner), 'people'];
}

export function peopleKey(owner: OrderSubmissionOwner, token: string) {
  return [...allPeopleKey(owner), token];
}

export async function readPeople(token: string, guard: () => void) {
  guard();
  const { data } = await getRegisterTransferMembers(apiClient, token, { ledovaSubmissionGuard: guard });
  guard();
  if (!isRegisterImportMembers(data))
    throw new Error('The company shareholder and award recipient choices could not be confirmed.');
  return data;
}

export function usePeople(owner: OrderSubmissionOwner, token: string, guard: () => void, enabled = true) {
  return useQuery({
    queryKey: peopleKey(owner, token),
    enabled,
    queryFn: () => readPeople(token, guard),
    ...READ_TIMING,
  });
}

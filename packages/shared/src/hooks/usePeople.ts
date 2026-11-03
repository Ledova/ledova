import { useQuery } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { READ_TIMING } from '../constants/api';
import { getRegisterTransferMembers } from '../services/register-transfers';
import { isRegisterImportMembers } from '../utils/register-imports';
import { useApiClient } from './useApiClient';
import { registerKey } from './useCompanyOwnership';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function allPeopleKey(owner: OrderSubmissionOwner) {
  return [...registerKey(owner), 'people'];
}

export function peopleKey(owner: OrderSubmissionOwner, token: string) {
  return [...allPeopleKey(owner), token];
}

export async function readPeople(
  apiClient: AxiosInstance,
  token: string,
  guard: () => void,
  session?: OrderSubmissionSession,
) {
  guard();
  const { data } = await getRegisterTransferMembers(apiClient, token, {
    ...session?.requestConfig(),
    ledovaSubmissionGuard: guard,
  });
  guard();
  if (!isRegisterImportMembers(data))
    throw new Error('The company shareholder and award recipient choices could not be confirmed.');
  return data;
}

export function usePeople(
  owner: OrderSubmissionOwner,
  token: string,
  guard: () => void,
  enabled = true,
  session?: OrderSubmissionSession,
) {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: peopleKey(owner, token),
    enabled,
    queryFn: () => readPeople(apiClient, token, guard, session),
    ...READ_TIMING,
  });
}

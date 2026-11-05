import { useQuery } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { READ_TIMING } from '../constants/api';
import { getCompanyTokenHolders } from '../services/company-tokens';
import { useApiClient } from './useApiClient';
import { registerHoldersKey } from './useCompanyOwnership';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function registersKey(owner: OrderSubmissionOwner, uuids: string[]) {
  return [...registerHoldersKey(owner), ...uuids];
}

export async function readRegister(
  apiClient: AxiosInstance,
  uuid: string,
  guard: () => void,
  session?: OrderSubmissionSession,
) {
  guard();
  const { data: register } = await getCompanyTokenHolders(apiClient, uuid, {
    ...session?.requestConfig(),
    ledovaSubmissionGuard: guard,
  });
  guard();
  const quantities = [
    register.token.totalSupply,
    ...register.holders.map(({ balance }) => balance),
    ...(register.formerMembers ?? []).map(({ sharesAtCessation }) => sharesAtCessation),
  ];
  if (register.issuedSupply !== null) quantities.push(register.issuedSupply);
  if (register.token.uuid !== uuid || quantities.some((value) => !/^\d+$/.test(value))) {
    throw new Error('Register did not identify exact share quantities for this class');
  }
  return register;
}

export function registersQuery(
  apiClient: AxiosInstance,
  owner: OrderSubmissionOwner,
  uuids: string[],
  guard: () => void,
  session?: OrderSubmissionSession,
) {
  return {
    queryKey: registersKey(owner, uuids),
    enabled: uuids.length > 0,
    queryFn: () => Promise.all(uuids.map((uuid) => readRegister(apiClient, uuid, guard, session))),
    ...READ_TIMING,
  };
}

export function useRegisters(
  owner: OrderSubmissionOwner,
  uuids: string[],
  guard: () => void,
  session?: OrderSubmissionSession,
  available = true,
) {
  const apiClient = useApiClient();
  return useQuery({
    ...registersQuery(apiClient, owner, uuids, guard, session),
    enabled: available && uuids.length > 0,
  });
}

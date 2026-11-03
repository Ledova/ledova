import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  USER_PREFERENCES_QUERY_KEY,
  ownershipSummary,
  useRegisterClasses,
  useRegisters,
  useUserPreferences,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { orderSubmissionSession } from '../../services/orderSubmissions';

export function useCompanyRegisters(
  owner: OrderSubmissionOwner,
  currentOwner: () => OrderSubmissionOwner | null,
  company: string,
  page: string,
) {
  const client = useQueryClient();
  const preferenceRead = useUserPreferences();
  const guard = useMemo(
    () => () => {
      if (currentOwner() !== owner) throw new Error(`Your signed-in account changed. Reopen ${page}.`);
    },
    [currentOwner, owner, page],
  );
  const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const settled = preferences?.status === 'success' && preferences.fetchStatus === 'idle';
  const classes = useRegisterClasses(owner, guard, orderSubmissionSession);
  const tokens = (classes.data ?? []).filter((item) => item.companyUuid === company).map(({ uuid }) => uuid);
  const read = useRegisters(owner, tokens, guard, orderSubmissionSession);
  const loaded = classes.isSuccess && (tokens.length === 0 || (read.isSuccess && read.data.length === tokens.length));
  const registers = loaded ? (tokens.length ? read.data : []) : undefined;
  const sourceReady = settled && loaded && !classes.isFetching && !read.isFetching;
  let ownershipReady = false;
  if (sourceReady && registers) {
    try {
      ownershipSummary(registers);
      ownershipReady = true;
    } catch {
      ownershipReady = false;
    }
  }
  return {
    guard,
    registers,
    sourceReady,
    ownershipReady,
    invalid: sourceReady && !ownershipReady,
    accountError: preferenceRead.isError,
    retryAccount: () => preferenceRead.refetch(),
    hasError: classes.isError || (tokens.length > 0 && read.isError),
    isRefreshing: preferenceRead.isFetching || classes.isFetching || read.isFetching,
    retry: () => Promise.all([classes.refetch(), ...(tokens.length ? [read.refetch()] : [])]),
  };
}

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  USER_PREFERENCES_QUERY_KEY,
  ownershipSummary,
  useRegisterClasses,
  useRegisters,
  useUserPreferences,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { orderSubmissionSession } from '../services/orderSubmissions';

const EMPTY_REGISTERS: TokenHoldersResponse[] = [];

export function useCompanyRegisters(
  owner: OrderSubmissionOwner,
  currentOwner: () => OrderSubmissionOwner | null,
  company: string,
  page: string,
  available = true,
) {
  const client = useQueryClient();
  const preferenceRead = useUserPreferences();
  const accountGuard = useMemo(
    () => () => {
      if (currentOwner() !== owner) throw new Error(`Your signed-in account changed. Reopen ${page}.`);
    },
    [currentOwner, owner, page],
  );
  const live = useRef(available);
  useLayoutEffect(() => {
    live.current = available;
    return () => {
      live.current = false;
    };
  }, [available]);
  const guard = useMemo(
    () => () => {
      accountGuard();
      if (!live.current) throw new Error(`Your company access could not be confirmed. Reopen ${page}.`);
    },
    [accountGuard, page],
  );
  const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const settled = preferences?.status === 'success' && preferences.fetchStatus === 'idle';
  const classes = useRegisterClasses(owner, accountGuard, orderSubmissionSession, available);
  const tokens = (classes.data ?? []).filter((item) => item.companyUuid === company).map(({ uuid }) => uuid);
  const read = useRegisters(owner, tokens, guard, orderSubmissionSession, available);
  const loaded = classes.isSuccess && (tokens.length === 0 || (read.isSuccess && read.data.length === tokens.length));
  const [kept, setKept] = useState<{
    owner: OrderSubmissionOwner;
    company: string;
    registers: TokenHoldersResponse[];
  } | null>(null);
  const current = loaded ? (tokens.length ? read.data : EMPTY_REGISTERS) : undefined;
  if (available && current && (kept?.owner !== owner || kept.company !== company || kept.registers !== current))
    setKept({ owner, company, registers: current });
  const registers =
    available && current ? current : kept?.owner === owner && kept.company === company ? kept.registers : undefined;
  const sourceReady = available && settled && loaded && !classes.isFetching && !read.isFetching;
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
    accountGuard,
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

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { OrderSubmissionOwner } from '@ledova/shared';
import { orderSubmissionSession } from '../services/orderSubmissions';

export function useRetainedScope(
  owner: OrderSubmissionOwner | null,
  currentOwner: () => OrderSubmissionOwner | null,
  requested: string | undefined,
  available: boolean,
  selection: string | null | undefined = requested,
) {
  const epoch = orderSubmissionSession.getEpoch();
  const [kept, setKept] = useState<{
    owner: OrderSubmissionOwner;
    epoch: number;
    scope: string;
    selection: string | null | undefined;
  } | null>(null);
  const sameOwner = !!kept && kept.owner === owner && kept.epoch === epoch;
  const sameSelection = sameOwner && kept?.selection === selection;
  const fallback = sameSelection && requested !== undefined && requested !== kept?.scope;
  const ready = !!owner && available && requested !== undefined && !fallback;
  if (
    ready &&
    (!kept || kept.owner !== owner || kept.epoch !== epoch || kept.scope !== requested || kept.selection !== selection)
  )
    setKept({ owner, epoch, scope: requested, selection });
  const scope = ready
    ? requested
    : kept && sameOwner && (sameSelection || requested === undefined || requested === kept.scope)
      ? kept.scope
      : undefined;
  const live = useRef({ owner, epoch, scope, available: ready });
  useLayoutEffect(() => {
    live.current = { owner, epoch, scope, available: ready };
  });
  const confirmedOwner = useCallback(() => {
    const value = live.current;
    return value.available &&
      value.owner === owner &&
      value.scope === scope &&
      value.epoch === epoch &&
      epoch === orderSubmissionSession.getEpoch() &&
      currentOwner() === owner
      ? owner
      : null;
  }, [currentOwner, owner, epoch, scope]);
  return { scope, available: ready && scope === requested, currentOwner: confirmedOwner };
}

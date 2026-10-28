import { getCapitalIncreases, getCompanyTokenIssuances, getShareIssuanceRequests } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { guarded } from '@pages/company/ledger/shared/registerReads';
import type { useShareClass } from '@pages/company/ledger/shared/useShareClass';
import { useRecordFeed } from './useRecordFeed';

export function useChainHistory(uuid: string, data: ReturnType<typeof useShareClass>) {
  const config = { ledovaSubmissionGuard: data.guard };
  const policy = { paused: data.readingPaused };
  const issuances = useRecordFeed(
    [...data.tokenKey, 'issuances'],
    (page) => guarded(data.guard, () => getCompanyTokenIssuances(apiClient, uuid, { page }, config)),
    data.isOwner,
    policy,
  );
  const capital = useRecordFeed(
    [...data.tokenKey, 'capital-increases'],
    (page) => guarded(data.guard, () => getCapitalIncreases(apiClient, { token: uuid, page }, config)),
    data.isOwner,
    policy,
  );
  const requests = useRecordFeed(
    [...data.tokenKey, 'issuance-requests'],
    (page) => guarded(data.guard, () => getShareIssuanceRequests(apiClient, { token: uuid, page }, config)),
    data.isOwner,
    policy,
  );
  return { issuances, capital, requests };
}

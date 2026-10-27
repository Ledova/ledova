import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getOwnMemberRecord,
  hasWholeShares,
  ownMemberRecordsKey,
  USER_PREFERENCES_QUERY_KEY,
  useSubmissionOwner,
  type OwnMemberRecord,
} from '@ledova/shared';
import { READ_TIMING } from '@hooks/useRegisterAccess';
import apiClient from '@services/apiClient';

export function useOwnershipMember(company: string, summary: OwnMemberRecord | undefined, enabled: boolean) {
  const { owner, boundary } = useSubmissionOwner();
  const client = useQueryClient();
  return useQuery({
    queryKey: [...ownMemberRecordsKey(owner), summary?.uuid ?? ''],
    enabled: enabled && !!summary && !!owner,
    queryFn: async ({ signal }) => {
      const guard = () => {
        const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
        const list = client.getQueryState(ownMemberRecordsKey(owner));
        if (
          !owner ||
          boundary.get() !== owner ||
          preferences?.status !== 'success' ||
          preferences.fetchStatus !== 'idle' ||
          list?.status !== 'success' ||
          list.fetchStatus !== 'idle' ||
          !client
            .getQueryData<OwnMemberRecord[]>(ownMemberRecordsKey(owner))
            ?.some((row) => row.uuid === summary?.uuid && row.company.uuid === company)
        )
          throw new Error('Your member association changed. Reopen your company.');
      };
      guard();
      const { data } = await getOwnMemberRecord(apiClient, summary!.uuid, { signal, ledovaSubmissionGuard: guard });
      guard();
      if (
        data.uuid !== summary!.uuid ||
        data.company.uuid !== company ||
        data.member !== summary!.member ||
        data.identitySource !== 'company_recorded' ||
        !hasWholeShares(data.classes) ||
        new Set(data.classes.map(({ uuid }) => uuid)).size !== data.classes.length
      )
        throw new Error('Your current company holdings could not be confirmed.');
      return data;
    },
    ...READ_TIMING,
    staleTime: 0,
  });
}

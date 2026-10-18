import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getRegisterTransferMembers,
  isRegisterImportMembers,
  useSubmissionOwner,
  type RegisterAwardRecipient,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { assertSessionEpoch } from '../../services/sessionScope';

type Owner = ReturnType<typeof useSubmissionOwner>['owner'];

export const registerImportMembersKey = (owner: Owner, epoch: number, company: string, token: string) =>
  ['register-import-members', owner, epoch, company, token] as const;

export function useRegisterImportMembers(epoch: number, company: string, token: string) {
  const queryClient = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const key = registerImportMembersKey(owner, epoch, company, token);
  const sessionGuard = () => {
    assertSessionEpoch(epoch);
    if (!owner || boundary.get() !== owner) throw new Error('Your signed-in account changed. Reopen these records.');
  };
  const query = useQuery({
    queryKey: key,
    enabled: !!owner,
    queryFn: async ({ signal }) => {
      sessionGuard();
      const { data } = await getRegisterTransferMembers(apiClient, token, {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: sessionGuard,
        signal,
      });
      sessionGuard();
      if (!isRegisterImportMembers(data))
        throw new Error('The member selector did not return distinct retained identities.');
      return data;
    },
  });
  const matches = (selected: RegisterAwardRecipient) =>
    !!query.data?.awardRecipients.some(
      (recipient) =>
        recipient.member === selected.member &&
        recipient.name === selected.name &&
        recipient.residentialAddress === selected.residentialAddress,
    );
  const guard = (selected: RegisterAwardRecipient[]) => {
    sessionGuard();
    const current = queryClient.getQueryState(key);
    if (
      current?.status !== 'success' ||
      current.fetchStatus !== 'idle' ||
      queryClient.getQueryData(key) !== query.data ||
      selected.some((recipient) => !matches(recipient))
    )
      throw new Error('Refresh the company member identities before continuing.');
  };
  return { query, matches, guard };
}

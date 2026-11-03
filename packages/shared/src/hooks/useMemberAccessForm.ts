import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { READ_TIMING } from '../constants/api';
import { getRegisterAwards } from '../services/register-awards';
import type { TokenHoldersResponse } from '../types';
import { invitationMembers } from '../utils/invitationMembers';
import { readEveryPage } from '../utils/pagination';
import { useApiClient } from './useApiClient';
import { registerKey } from './useCompanyOwnership';
import { useCompanyMemberAccess } from './useCompanyMemberAccess';
import type { Problems } from './useErrorSummary';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

type MemberField = 'member' | 'email' | 'reason';

export const INVITATION_FIELDS: readonly MemberField[] = ['member', 'email'];

export function useMemberAccessForm({
  company,
  owner,
  guard,
  registers,
  sourceReady = true,
  inviteMember = '',
  newKey,
  session,
}: {
  company: string;
  owner: OrderSubmissionOwner;
  guard: () => void;
  registers: TokenHoldersResponse[];
  sourceReady?: boolean;
  inviteMember?: string;
  newKey: () => string;
  session?: OrderSubmissionSession;
}) {
  const apiClient = useApiClient();
  const access = useCompanyMemberAccess(company, newKey, session, sourceReady);
  const guardRecipients = () => {
    guard();
    access.guardAdmin();
  };
  const awards = useQuery({
    queryKey: [...registerKey(owner), 'invitation-awards', company],
    enabled: !!access.admin && sourceReady,
    queryFn: () =>
      readEveryPage(async (page) => {
        guardRecipients();
        const response = await getRegisterAwards(
          apiClient,
          { company, page },
          { ...session?.requestConfig(), ledovaSubmissionGuard: guardRecipients },
        );
        guardRecipients();
        return response;
      }),
    ...READ_TIMING,
  });
  let candidates = [] as ReturnType<typeof invitationMembers>;
  let recipientsError = '';
  if (access.admin && sourceReady && awards.isSuccess && !awards.isFetching) {
    try {
      candidates = invitationMembers(registers, awards.data, company);
    } catch (failure) {
      recipientsError = failure instanceof Error ? failure.message : 'The company recipients could not be confirmed.';
    }
  }
  const recipientsReady = !!access.admin && sourceReady && awards.isSuccess && !awards.isFetching && !recipientsError;
  const [invitation, setInvitation] = useState({ company, member: inviteMember, email: '' });
  const member = invitation.company === company ? candidates.find(({ uuid }) => uuid === invitation.member) : undefined;
  const email = invitation.company === company ? invitation.email : '';
  const memberName = (uuid: string) =>
    candidates.find((candidate) => candidate.uuid === uuid)?.name ||
    registers.flatMap((register) => register.holders).find((holder) => holder.member === uuid)?.name ||
    'Company member';
  if (invitation.company !== company || (recipientsReady && invitation.member && !member))
    setInvitation({ company, member: '', email: '' });
  const [reason, setReason] = useState('');
  const held = access.busy || !!access.retry;
  const problems: Problems<MemberField> = {
    member: !member && 'Choose the member or award recipient.',
    email: !email.trim() && 'Give the intended recipient’s email.',
    reason: !!access.admin && !reason.trim() && 'Give the company action reason.',
  };
  const refresh = async () => {
    await access.refresh();
    await awards.refetch();
  };
  return {
    access,
    awards,
    candidates,
    recipientsError,
    recipientsReady,
    member,
    email,
    memberName,
    setInvitation,
    reason,
    setReason,
    held,
    problems,
    refresh,
  };
}

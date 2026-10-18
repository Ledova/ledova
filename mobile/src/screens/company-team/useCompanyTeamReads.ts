import { useQuery } from '@tanstack/react-query';
import {
  getCompanyTeam,
  getCompanyTeamInvitations,
  getOwnCompanyAppointments,
  readEveryPage,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';

export function companyTeamScope(owner: OrderSubmissionOwner, epoch: number) {
  return ['company-team', owner.userUuid, owner.ownerAccountUuid, epoch];
}

export function companyTeamAppointmentsKey(owner: OrderSubmissionOwner, epoch: number) {
  return [...companyTeamScope(owner, epoch), 'appointments'];
}

export function companyTeamInvitationsKey(owner: OrderSubmissionOwner, epoch: number) {
  return [...companyTeamScope(owner, epoch), 'invitations'];
}

export function companyTeamKey(owner: OrderSubmissionOwner, epoch: number, company: string | undefined) {
  return [...companyTeamScope(owner, epoch), 'team', company];
}

export function useCompanyTeamReads({
  owner,
  epoch,
  company,
  guard,
}: {
  owner: OrderSubmissionOwner;
  epoch: number;
  company: string | undefined;
  guard: () => void;
}) {
  const scope = companyTeamScope(owner, epoch);
  const appointmentsKey = companyTeamAppointmentsKey(owner, epoch);
  const invitationsKey = companyTeamInvitationsKey(owner, epoch);
  const teamKey = companyTeamKey(owner, epoch, company);
  const appointments = useQuery({
    queryKey: appointmentsKey,
    retry: false,
    queryFn: ({ signal }) =>
      readEveryPage(async (page) => {
        guard();
        const response = await getOwnCompanyAppointments(apiClient, page, {
          ledovaSessionEpoch: epoch,
          ledovaSubmissionGuard: guard,
          signal,
        });
        guard();
        return response;
      }),
  });
  const invitations = useQuery({
    queryKey: invitationsKey,
    retry: false,
    queryFn: ({ signal }) =>
      readEveryPage(async (page) => {
        guard();
        const response = await getCompanyTeamInvitations(apiClient, page, {
          ledovaSessionEpoch: epoch,
          ledovaSubmissionGuard: guard,
          signal,
        });
        guard();
        return response;
      }),
  });
  const own = appointments.isSuccess ? appointments.data : [];
  const current = own.filter(
    (record) => record.company === company && record.isEffective && record.status === 'active',
  );
  const administers = current.some((record) => record.capabilities.includes('admin'));
  const team = useQuery({
    queryKey: teamKey,
    enabled: !!company && administers && !appointments.isFetching,
    retry: false,
    queryFn: async ({ signal }) => {
      guard();
      const response = await getCompanyTeam(apiClient, company!, {
        ledovaSessionEpoch: epoch,
        ledovaSubmissionGuard: guard,
        signal,
      });
      guard();
      if (response.data.some((record) => record.company !== company))
        throw new Error('The team response did not match the selected company.');
      return response.data;
    },
  });
  return { scope, appointmentsKey, teamKey, appointments, invitations, team, own, current, administers };
}

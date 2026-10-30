import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import {
  getCompanyTeam,
  getCompanyTeamInvitations,
  readEveryPage,
  revokeCompanyAppointment,
  USER_PREFERENCES_QUERY_KEY,
  assertSessionSettled,
  type CompanyTeamAppointment,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  failureSentence,
} from '@ledova/shared';
import { appointmentReceipt, currentAppointment, sameScope } from '@pages/company/shared/appointments';
import apiClient from '@services/apiClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useCompanyContext } from '@hooks/useCompanyContext';

export function teamInvitationsKey(owner: OrderSubmissionOwner) {
  return ['company-team-invitations', owner.userUuid, owner.ownerAccountUuid];
}

export function companyTeamKey(owner: OrderSubmissionOwner, company: string) {
  return ['company-team', owner.userUuid, owner.ownerAccountUuid, company];
}

export function useCompanyTeam({
  owner,
  currentOwner,
  editing = false,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  editing?: boolean;
}) {
  const client = useQueryClient();
  const mounted = useRef(true);
  const guard = useCallback(() => {
    if (
      !mounted.current ||
      currentOwner() !== owner ||
      client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status !== 'success'
    )
      throw new Error('Your signed-in account changed. Reopen company team.');
  }, [client, currentOwner, owner]);
  const ownKey = ownAppointmentsKey(owner);
  const invitationKey = teamInvitationsKey(owner);
  const location = useLocation();
  const context = useCompanyContext();
  const selectedCompany = new URLSearchParams(location.search).get('company');
  const [sourceId, setSourceId] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  type Confirmation = {
    ticket: symbol;
    appointment: OwnCompanyAppointment | CompanyTeamAppointment;
    companyName: string;
  };
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const ticket = useRef<symbol | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ticket.current = null;
    };
  }, []);
  const refreshReady = !editing && !formBusy && !revoking && !confirmation;
  const own = useOwnAppointments(owner, guard, { queryKey: ownKey, timing: {}, enabled: refreshReady });
  const invitations = useQuery({
    queryKey: invitationKey,
    enabled: refreshReady,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () =>
      readEveryPage(async (page) => {
        guard();
        const result = await getCompanyTeamInvitations(apiClient, page, { ledovaSubmissionGuard: guard });
        guard();
        return result;
      }),
  });
  const appointments = own.isError ? [] : (own.data ?? []);
  const companies = [...new Map(appointments.map((item) => [item.company, item.companyName])).entries()];
  const company = context
    ? (context.companyUuid ?? '')
    : (selectedCompany ?? (companies.length === 1 ? companies[0][0] : ''));
  const sources = appointments.filter(
    (item) => item.company === company && currentAppointment(item) && item.delegatableCapabilities.length > 0,
  );
  const source = sources.find((item) => item.uuid === sourceId);
  const canAdmin =
    !own.isError &&
    !own.isFetching &&
    appointments.some(
      (item) => item.company === company && currentAppointment(item) && item.capabilities.includes('admin'),
    );
  const teamKey = companyTeamKey(owner, company);
  const team = useQuery({
    queryKey: teamKey,
    enabled: !!company && canAdmin && refreshReady,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: async () => {
      guard();
      const result = await getCompanyTeam(apiClient, company, { ledovaSubmissionGuard: guard });
      guard();
      if (result.data.some((item) => item.company !== company))
        throw new Error('The company team outcome could not be confirmed.');
      return result.data;
    },
  });
  const disabled = formBusy || revoking;
  const close = () => {
    ticket.current = null;
    setConfirmation(null);
  };
  const canRevoke = (target: OwnCompanyAppointment | CompanyTeamAppointment) => {
    const key = 'name' in target ? teamKey : ownKey;
    const state = client.getQueryState(key);
    const rows = client.getQueryData<(OwnCompanyAppointment | CompanyTeamAppointment)[]>(key);
    const latest = rows?.find((item) => item.uuid === target.uuid && item.company === target.company);
    const authority = client.getQueryData<OwnCompanyAppointment[]>(ownKey) ?? [];
    return (
      state?.status === 'success' &&
      state.fetchStatus === 'idle' &&
      latest?.status !== 'revoked' &&
      !!latest &&
      (!('name' in target) ||
        (client.getQueryState(ownKey)?.status === 'success' &&
          client.getQueryState(ownKey)?.fetchStatus === 'idle' &&
          authority.some(
            (item) =>
              item.company === target.company && currentAppointment(item) && item.capabilities.includes('admin'),
          )))
    );
  };
  const confirm = (appointment: OwnCompanyAppointment | CompanyTeamAppointment, companyName: string) => {
    if (disabled || ticket.current || !canRevoke(appointment)) return;
    ticket.current = Symbol();
    setConfirmation({ ticket: ticket.current, appointment, companyName });
  };
  const revoke = async (target: OwnCompanyAppointment | CompanyTeamAppointment) => {
    if (pending.current) return;
    pending.current = true;
    setRevoking(true);
    setError('');
    try {
      const check = () => {
        guard();
        assertSessionSettled(client);
        if (!canRevoke(target))
          throw new Error('Your company appointment changed. Check the current record before revoking it.');
      };
      check();
      const { data } = await revokeCompanyAppointment(apiClient, target.uuid, { ledovaSubmissionGuard: check });
      guard();
      if (
        !appointmentReceipt(data) ||
        data.uuid !== target.uuid ||
        data.company !== target.company ||
        data.source !== target.source ||
        data.status !== 'revoked' ||
        !data.revokedAt ||
        data.isEffective ||
        !sameScope(data.capabilities, target.capabilities) ||
        !sameScope(data.delegatableCapabilities, target.delegatableCapabilities) ||
        data.createdAt !== target.createdAt ||
        data.expiresAt !== target.expiresAt
      )
        throw new Error('The revocation outcome could not be confirmed. Retry the same appointment.');
      await Promise.all([
        client.cancelQueries({ queryKey: ownKey, exact: true }),
        client.cancelQueries({ queryKey: teamKey, exact: true }),
      ]);
      guard();
      if (client.getQueryState(ownKey)?.status !== 'error')
        client.setQueryData<OwnCompanyAppointment[]>(ownKey, (previous) =>
          previous?.map((item) => (item.uuid === data.uuid ? data : item)),
        );
      if (client.getQueryState(teamKey)?.status !== 'error')
        client.setQueryData<CompanyTeamAppointment[]>(teamKey, (previous) =>
          previous?.map((item) =>
            item.uuid === data.uuid
              ? { ...item, status: data.status, revokedAt: data.revokedAt, isEffective: false }
              : item,
          ),
        );
    } catch (failure) {
      try {
        guard();
        setError(failureSentence(failure, 'The appointment could not be revoked. Check the current record and retry.'));
      } catch {
        return;
      }
    } finally {
      pending.current = false;
      if (mounted.current) setRevoking(false);
    }
  };
  const issueGuard = () => {
    guard();
    const latest = client.getQueryData<OwnCompanyAppointment[]>(ownKey) ?? [];
    const current = latest.find((item) => item.uuid === source?.uuid && item.company === company);
    const administrator = latest.some(
      (item) => item.company === company && currentAppointment(item) && item.capabilities.includes('admin'),
    );
    if (
      client.getQueryState(ownKey)?.status !== 'success' ||
      client.getQueryState(ownKey)?.fetchStatus !== 'idle' ||
      !current ||
      !currentAppointment(current) ||
      !source ||
      !sameScope(current.delegatableCapabilities, source.delegatableCapabilities) ||
      (canAdmin && !administrator)
    )
      throw new Error('Your company appointment changed. Reopen the invitation and select a current source.');
  };
  const companyName = companies.find(([uuid]) => uuid === company)?.[1] ?? context?.company?.name ?? '';
  return {
    guard,
    company,
    sourceId,
    setSourceId,
    setFormBusy,
    error,
    confirmation,
    ticket,
    own,
    invitations,
    appointments,
    sources,
    source,
    canAdmin,
    team,
    disabled,
    revoking,
    close,
    canRevoke,
    confirm,
    revoke,
    issueGuard,
    companyName,
  };
}

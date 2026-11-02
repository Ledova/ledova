import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getOwnCompanyAppointments } from '../services/company-authority';
import {
  sendMemberInvitationEmail,
  getMemberInvitations,
  getMemberAssociations,
  revokeMemberAssociation,
} from '../services/member-access';
import { hasCurrentRegisterReadAuthority } from '../utils/register-commands';
import { isCurrentEligibilityAppointment } from './useCompanyEligibilityRecords';
import { failureStatus, failureSentence } from '../utils/errors';
import { readEveryPage } from '../utils/pagination';
import { useSubmissionOwner } from './useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY } from './useUserPreferences';
import type { OrderSubmissionSession } from './useSubmissionOwner';
import type { MemberInvitationCreate, OwnCompanyAppointment } from '../types';
import { useApiClient } from './useApiClient';

type Command =
  | { kind: 'invite'; payload: MemberInvitationCreate }
  | { kind: 'revoke'; uuid: string; payload: { appointment: string; idempotencyKey: string; reason: string } };

export function useCompanyMemberAccess(
  company: string,
  newKey: () => string,
  session?: OrderSubmissionSession,
  sourceReady = true,
) {
  const api = useApiClient();
  const client = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(session);
  const live = useRef(true);
  const source = useRef(sourceReady);
  source.current = sourceReady;
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<Command | null>(null);
  const [notice, setNotice] = useState('');
  const [invitationReceipt, setInvitationReceipt] = useState('');
  const scope = ['company-member-access', owner?.userUuid, owner?.ownerAccountUuid, session?.getEpoch() ?? 0, company];
  const appointmentKey = [...scope, 'appointments'];
  const adminKey = [...scope, 'admin'];
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    setRetry(null);
    setNotice('');
    setInvitationReceipt('');
    setError(null);
  }, [owner, company]);
  const guardOwner = () => {
    const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    if (
      !live.current ||
      !source.current ||
      !owner ||
      boundary.get() !== owner ||
      preferences?.status !== 'success' ||
      preferences.fetchStatus !== 'idle'
    )
      throw new Error('Your signed-in account changed. Reopen member access.');
  };
  const config = (guard = guardOwner) => ({ ...session?.requestConfig(), ledovaSubmissionGuard: guard });
  const appointments = useQuery({
    queryKey: appointmentKey,
    enabled: !!owner && sourceReady,
    queryFn: () =>
      readEveryPage(async (page) => {
        guardOwner();
        const response = await getOwnCompanyAppointments(api, page, config());
        guardOwner();
        return response;
      }),
  });
  const currentAppointments = () => {
    guardOwner();
    const state = client.getQueryState(appointmentKey);
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw new Error('Refresh your current company appointments.');
    return client.getQueryData<OwnCompanyAppointment[]>(appointmentKey) ?? [];
  };
  const guardRead = () => {
    if (!hasCurrentRegisterReadAuthority(currentAppointments(), company))
      throw new Error('A current company register appointment is required.');
  };
  const adminAppointment = (rows: OwnCompanyAppointment[]) =>
    rows.find(
      (row) => row.company === company && isCurrentEligibilityAppointment(row) && row.capabilities.includes('admin'),
    );
  const rows = appointments.isSuccess && appointments.fetchStatus === 'idle' ? appointments.data : [];
  const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const readable =
    !!owner &&
    sourceReady &&
    preferences?.status === 'success' &&
    preferences.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(rows, company);
  const admin = adminAppointment(rows);
  const guardAdmin = () => {
    guardRead();
    if (!adminAppointment(currentAppointments())) throw new Error('Current personal ADMIN authority is required.');
  };
  const access = useQuery({
    queryKey: adminKey,
    enabled: !!admin,
    queryFn: async () => {
      const [invitations, associations] = await Promise.all([
        readEveryPage(async (page) => {
          guardAdmin();
          const response = await getMemberInvitations(api, company, page, config(guardAdmin));
          guardAdmin();
          return response;
        }),
        readEveryPage(async (page) => {
          guardAdmin();
          const response = await getMemberAssociations(api, company, page, config(guardAdmin));
          guardAdmin();
          return response;
        }),
      ]);
      if ([...invitations, ...associations].some((row) => row.company !== company))
        throw new Error('The member access belongs to another company.');
      return { invitations, associations };
    },
  });
  const guardAccess = () => {
    guardAdmin();
    const state = client.getQueryState(adminKey);
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw new Error('Refresh current member access before continuing.');
  };
  const refresh = async () => {
    guardOwner();
    await appointments.refetch({ throwOnError: true });
    guardRead();
    if (adminAppointment(currentAppointments())) await access.refetch({ throwOnError: true });
  };
  const execute = async (command: Command) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      guardAccess();
      if (adminAppointment(currentAppointments())?.uuid !== command.payload.appointment)
        throw new Error('Your exact company appointment changed. Refresh before continuing.');
      setRetry(command);
      if (command.kind === 'invite') {
        const { data } = await sendMemberInvitationEmail(api, command.payload, config(guardAccess));
        guardAccess();
        if (
          data.uuid !== command.payload.operationId ||
          data.company !== company ||
          data.member !== command.payload.member ||
          data.appointment !== command.payload.appointment ||
          data.intendedEmail.toLowerCase() !== command.payload.intendedEmail.toLowerCase()
        )
          throw new Error('The invitation result does not match the original request.');
        if (data.emailDelivery !== 'accepted')
          throw new Error('The invitation email could not be confirmed. Retry the original action.');
        setInvitationReceipt(data.uuid);
        setNotice('The invitation email was accepted for sending. Awaiting the recipient’s acceptance.');
      } else {
        const { data } = await revokeMemberAssociation(api, command.uuid, command.payload, config(guardAccess));
        guardAccess();
        if (data.uuid !== command.uuid || data.company !== company || data.current)
          throw new Error('The association revocation could not be confirmed.');
      }
      setRetry(null);
      await refresh();
    } catch (failure) {
      if (failureStatus(failure) && failureStatus(failure)! < 500) setRetry(null);
      if (live.current && boundary.get() === owner)
        setError(failureSentence(failure, 'The result could not be confirmed. Refresh or retry the original command.'));
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  const accessReady = readable && !!admin && access.isSuccess && access.fetchStatus === 'idle';
  const readFailed = [appointments, access].some((query) => query.isError);
  return {
    readable,
    admin: accessReady ? admin : undefined,
    canAdminister: readable && !!admin,
    access: accessReady ? access.data : null,
    busy,
    retry,
    notice: readable ? notice : '',
    invitationReceipt: accessReady ? invitationReceipt : '',
    readFailed,
    failure: error,
    error: error ?? (readFailed ? 'Current member access could not be read. Refresh before continuing.' : null),
    refresh: () =>
      refresh().catch((failure) => {
        if (live.current && boundary.get() === owner)
          setError(failureSentence(failure, 'The member access could not be refreshed.'));
      }),
    guardAdmin,
    invite: (member: string, intendedEmail: string) =>
      admin &&
      execute({
        kind: 'invite',
        payload: { operationId: newKey(), company, appointment: admin.uuid, member, intendedEmail },
      }),
    revoke: (uuid: string, reason: string) =>
      admin &&
      execute({ kind: 'revoke', uuid, payload: { appointment: admin.uuid, idempotencyKey: newKey(), reason } }),
    recover: () => retry && execute(retry),
  };
}

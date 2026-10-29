import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { getOwnCompanyAppointments } from '../services/company-authority';
import {
  sendMemberInvitationEmail,
  getMemberInvitations,
  getMemberAssociations,
  getMemberParticularsRequests,
  getMemberCertificateRequests,
  revokeMemberAssociation,
  prepareMemberParticularsRequest,
  getMemberCertificateFulfilmentPreview,
  fulfilMemberCertificateRequest,
} from '../services/member-access';
import { appointmentForRegisterStep, hasCurrentRegisterReadAuthority } from '../utils/register-commands';
import { isCurrentEligibilityAppointment } from './useCompanyEligibilityRecords';
import { failureStatus, failureSentence } from '../utils/errors';
import { readEveryPage } from '../utils/pagination';
import { useSubmissionOwner } from './useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY } from './useUserPreferences';
import type { OrderSubmissionSession } from './useSubmissionOwner';
import type {
  MemberInvitationCreate,
  OwnCompanyAppointment,
  MemberCertificateRequest,
  MemberCertificateFulfilmentPreview,
  MemberCertificateFulfilmentCreate,
} from '../types';
import { useApiClient } from './useApiClient';

type Command =
  | { kind: 'invite'; payload: MemberInvitationCreate }
  | { kind: 'fulfil'; uuid: string; payload: MemberCertificateFulfilmentCreate }
  | { kind: 'revoke'; uuid: string; payload: { appointment: string; idempotencyKey: string; reason: string } }
  | {
      kind: 'prepare';
      uuid: string;
      payload: { operationId: string; appointment: string; supportingEvidence: string; asAt: string; reason: string };
    };

export function useCompanyMemberAccess(
  company: string,
  newKey: () => string,
  session?: OrderSubmissionSession,
  sourceReady = true,
  particularsQueryKey?: QueryKey,
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
  const [certificateTarget, setCertificateTarget] = useState<{
    preview: MemberCertificateFulfilmentPreview;
    command: Extract<Command, { kind: 'fulfil' }>;
  } | null>(null);
  const scope = ['company-member-access', owner?.userUuid, owner?.ownerAccountUuid, session?.getEpoch() ?? 0, company];
  const appointmentKey = [...scope, 'appointments'];
  const queueKey = [...scope, 'requests'];
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
    setCertificateTarget(null);
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
  const prepare = appointmentForRegisterStep(rows, company, 'prepare');
  const queue = useQuery({
    queryKey: queueKey,
    enabled: readable,
    queryFn: async () => {
      const [particulars, certificates] = await Promise.all([
        readEveryPage(async (page) => {
          guardRead();
          const response = await getMemberParticularsRequests(api, { company, page }, config(guardRead));
          guardRead();
          return response;
        }),
        readEveryPage(async (page) => {
          guardRead();
          const response = await getMemberCertificateRequests(api, { company, page }, config(guardRead));
          guardRead();
          return response;
        }),
      ]);
      if ([...particulars, ...certificates].some((row) => row.company !== company))
        throw new Error('The member requests belong to another company.');
      return { particulars, certificates };
    },
  });
  const guardQueue = () => {
    guardRead();
    const state = client.getQueryState(queueKey);
    if (
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      client.getQueryState(adminKey)?.status === 'error'
    )
      throw new Error('Refresh current member requests before continuing.');
  };
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
    await queue.refetch({ throwOnError: true });
    if (adminAppointment(currentAppointments())) await access.refetch({ throwOnError: true });
  };
  const execute = async (command: Command) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const check = command.kind === 'prepare' || command.kind === 'fulfil' ? guardQueue : guardAccess;
      check();
      const appointment =
        command.kind === 'prepare'
          ? appointmentForRegisterStep(currentAppointments(), company, 'prepare')
          : command.kind === 'fulfil'
            ? currentAppointments().find(
                (row) => row.uuid === command.payload.appointment && hasCurrentRegisterReadAuthority([row], company),
              )
            : adminAppointment(currentAppointments());
      if (appointment?.uuid !== command.payload.appointment)
        throw new Error('Your exact company appointment changed. Refresh before continuing.');
      setRetry(command);
      if (command.kind === 'invite') {
        const { data } = await sendMemberInvitationEmail(api, command.payload, config(check));
        check();
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
      } else if (command.kind === 'revoke') {
        const { data } = await revokeMemberAssociation(api, command.uuid, command.payload, config(check));
        check();
        if (data.uuid !== command.uuid || data.company !== company || data.current)
          throw new Error('The association revocation could not be confirmed.');
      } else if (command.kind === 'fulfil') {
        const original = client
          .getQueryData<{ certificates: MemberCertificateRequest[] }>(queueKey)
          ?.certificates.find((row) => row.uuid === command.uuid);
        if (!original || original.status === 'withdrawn')
          throw new Error('The original certificate request is unavailable.');
        const { data } = await fulfilMemberCertificateRequest(api, command.uuid, command.payload, config(check));
        check();
        if (
          data.uuid !== command.uuid ||
          data.company !== company ||
          data.member !== original.member ||
          data.token !== original.token ||
          data.entry !== original.entry ||
          data.association !== original.association ||
          data.status !== 'fulfilled' ||
          !data.fulfilment ||
          data.fulfilment.uuid !== command.payload.operationId ||
          data.fulfilment.appointment !== command.payload.appointment ||
          data.fulfilment.sourceDigest !== command.payload.sourceDigest ||
          data.fulfilment.instruction !== command.payload.instruction ||
          !/^[a-f0-9]{64}$/.test(data.fulfilment.digest) ||
          !Number.isSafeInteger(data.fulfilment.fileSize) ||
          data.fulfilment.fileSize < 1
        )
          throw new Error('The certificate fulfilment does not match the original request. Retry the original action.');
        setCertificateTarget(null);
        setNotice('The unsigned recipient certificate is recorded. The member can download their own PDF.');
      } else {
        const original = client
          .getQueryData<{ particulars: { uuid: string; member: string; name: string; residentialAddress: string }[] }>(
            queueKey,
          )
          ?.particulars.find((row) => row.uuid === command.uuid);
        if (!original) throw new Error('The original member request is unavailable.');
        const { data } = await prepareMemberParticularsRequest(api, command.uuid, command.payload, config(check));
        check();
        if (
          data.uuid !== command.payload.operationId ||
          data.company !== company ||
          data.memberRequest !== command.uuid ||
          data.member !== original.member ||
          data.name !== original.name ||
          data.residentialAddress !== original.residentialAddress ||
          data.supportingEvidence !== command.payload.supportingEvidence ||
          data.preparingAppointment !== command.payload.appointment
        )
          throw new Error('The company instruction does not match the member request.');
        if (particularsQueryKey) await client.invalidateQueries({ queryKey: particularsQueryKey });
        setNotice(
          'Company particulars instruction recorded. Approval and application remain separate in Register particulars changes.',
        );
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
  const previewCertificate = async (uuid: string, instruction: string) => {
    if (pending.current || retry) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setCertificateTarget(null);
    try {
      guardQueue();
      const original = client
        .getQueryData<{ certificates: MemberCertificateRequest[] }>(queueKey)
        ?.certificates.find((row) => row.uuid === uuid && row.status === 'requested');
      if (!original) throw new Error('Refresh the original member certificate request.');
      const { data } = await getMemberCertificateFulfilmentPreview(api, uuid, config(guardQueue));
      guardQueue();
      if (
        data.memberRequest !== uuid ||
        data.company !== company ||
        data.member !== original.member ||
        data.token !== original.token ||
        data.entry !== original.entry ||
        !currentAppointments().some(
          (row) => row.uuid === data.appointment && hasCurrentRegisterReadAuthority([row], company),
        ) ||
        !/^[a-f0-9]{64}$/.test(data.sourceDigest) ||
        !Number.isSafeInteger(data.sequence) ||
        data.sequence < 1 ||
        !Number.isSafeInteger(data.registerSequence) ||
        data.registerSequence < data.sequence ||
        !Number.isSafeInteger(data.pageCount) ||
        data.pageCount !== 1
      )
        throw new Error('The certificate preview does not identify the requested member and entry.');
      setCertificateTarget({
        preview: Object.freeze({ ...data }),
        command: {
          kind: 'fulfil',
          uuid,
          payload: Object.freeze({
            operationId: newKey(),
            appointment: data.appointment,
            sourceDigest: data.sourceDigest,
            instruction,
          }),
        },
      });
    } catch (failure) {
      if (live.current && boundary.get() === owner)
        setError(failureSentence(failure, 'The certificate preview could not be confirmed.'));
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  };
  const queueReady = readable && queue.isSuccess && queue.fetchStatus === 'idle' && !access.isError;
  const accessReady = readable && !!admin && access.isSuccess && access.fetchStatus === 'idle';
  const readFailed = [appointments, queue, access].some((query) => query.isError);
  return {
    readable,
    certificateTarget: queueReady ? certificateTarget : null,
    previewCertificate,
    editCertificate: () => {
      if (!pending.current && !retry) setCertificateTarget(null);
    },
    fulfilCertificate: () => certificateTarget && execute(certificateTarget.command),
    admin: accessReady ? admin : undefined,
    canAdminister: readable && !!admin,
    prepare: queueReady ? prepare : undefined,
    requests: queueReady ? queue.data : null,
    access: accessReady ? access.data : null,
    busy,
    retry,
    notice: readable ? notice : '',
    invitationReceipt: accessReady ? invitationReceipt : '',
    readFailed,
    failure: error,
    error:
      error ?? (readFailed ? 'Current member access or requests could not be read. Refresh before continuing.' : null),
    refresh: () =>
      refresh().catch((failure) => {
        if (live.current && boundary.get() === owner)
          setError(failureSentence(failure, 'The member access could not be refreshed.'));
      }),
    guardPrepare: () => {
      guardQueue();
      if (!appointmentForRegisterStep(currentAppointments(), company, 'prepare'))
        throw new Error('Current preparation authority is required.');
    },
    invite: (member: string, intendedEmail: string) =>
      admin &&
      execute({
        kind: 'invite',
        payload: { operationId: newKey(), company, appointment: admin.uuid, member, intendedEmail },
      }),
    revoke: (uuid: string, reason: string) =>
      admin &&
      execute({ kind: 'revoke', uuid, payload: { appointment: admin.uuid, idempotencyKey: newKey(), reason } }),
    prepareRequest: (uuid: string, supportingEvidence: string, asAt: string, reason: string) =>
      prepare &&
      execute({
        kind: 'prepare',
        uuid,
        payload: { operationId: newKey(), appointment: prepare.uuid, supportingEvidence, asAt, reason },
      }),
    recover: () => retry && execute(retry),
  };
}

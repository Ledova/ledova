import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FIELD_LIMITS,
  appointmentForRegisterStep,
  createUserFriendlyError,
  failureSentence,
  failureStatus,
  getCompanyPeople,
  hasCurrentRegisterReadAuthority,
  isRegisterPersonRegistrationReceipt,
  peopleFrom,
  registerCompanyPerson,
  type OrderSubmissionOwner,
  type RegisterPersonRegistrationRequest,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { READ_TIMING } from '@hooks/useRegisterAccess';
import type { Problems } from '@hooks/useErrorSummary';
import { ownAppointmentsKey, useOwnAppointments } from '@hooks/useOwnAppointments';
import { allPeopleKey } from './shared/usePeople';

export function usePersonRegistration({
  owner,
  company,
  guard,
  sourceReady,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  guard: () => void;
  sourceReady: boolean;
  onHeldChange: (held: boolean) => void;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
  const live = useRef(true);
  const ready = useRef(sourceReady);
  const pending = useRef<{ request: RegisterPersonRegistrationRequest; uncertain: boolean; confirmed: boolean } | null>(
    null,
  );
  const running = useRef(false);
  const callback = useRef(onHeldChange);
  useLayoutEffect(() => {
    ready.current = sourceReady;
    callback.current = onHeldChange;
  }, [sourceReady, onHeldChange]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      callback.current(false);
    };
  }, []);
  const check = () => {
    guard();
    if (!live.current) throw createUserFriendlyError('This person form is closed. Reopen Shareholders.');
    if (!ready.current) throw createUserFriendlyError('The current company could not be confirmed. Try again.');
  };
  const appointments = useOwnAppointments(owner, guard, { enabled: sourceReady });
  const readable =
    sourceReady &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const query = useQuery({
    queryKey: [...allPeopleKey(owner), 'company', company],
    enabled: readable,
    queryFn: async () => {
      check();
      const { data } = await getCompanyPeople(apiClient, company, { ledovaSubmissionGuard: check });
      check();
      if (data.company !== company) throw new Error('The people do not belong to this company.');
      return peopleFrom({ ...data, awardRecipients: [] });
    },
    ...READ_TIMING,
    refetchOnMount: 'always',
  });
  const canPrepare =
    sourceReady &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    !!appointmentForRegisterStep(appointments.data, company, 'prepare');
  const peopleReady = readable && query.isSuccess && query.fetchStatus === 'idle';
  const problems: Problems<'name' | 'address'> = {
    name: !name.trim()
      ? 'Give the person’s name.'
      : Array.from(name.trim()).length > FIELD_LIMITS.NAME
        ? `Keep the name within ${FIELD_LIMITS.NAME} characters.`
        : false,
    address: !address.trim()
      ? 'Give the person’s residential address.'
      : Array.from(address.trim()).length > FIELD_LIMITS.RESIDENTIAL_ADDRESS
        ? `Keep the address within ${FIELD_LIMITS.RESIDENTIAL_ADDRESS} characters.`
        : false,
  };
  const open = () => {
    if (!canPrepare || !peopleReady || running.current || pending.current) return;
    setName('');
    setAddress('');
    setError('');
    setOutcome('');
    setEditing(true);
  };
  const close = () => {
    if (running.current || pending.current) return;
    setEditing(false);
    setError('');
  };
  const save = async () => {
    if (running.current || (!pending.current && (problems.name || problems.address))) return;
    running.current = true;
    setBusy(true);
    setError('');
    callback.current(true);
    try {
      check();
      let command = pending.current;
      if (!command) {
        const { data } = await appointments.refetch({ throwOnError: true });
        check();
        const appointment = appointmentForRegisterStep(data ?? [], company, 'prepare');
        if (!appointment) throw createUserFriendlyError('A current company preparation appointment is required.');
        const currentPeople = client.getQueryState([...allPeopleKey(owner), 'company', company]);
        if (currentPeople?.status !== 'success' || currentPeople.fetchStatus !== 'idle')
          throw createUserFriendlyError('The current company people could not be confirmed. Try again.');
        command = {
          request: {
            operationId: crypto.randomUUID(),
            company,
            appointment: appointment.uuid,
            member: crypto.randomUUID(),
            name: name.trim(),
            residentialAddress: address.trim(),
          },
          uncertain: false,
          confirmed: false,
        };
        pending.current = command;
        setHeld(true);
      }
      if (!command.confirmed) {
        const { data } = await registerCompanyPerson(apiClient, command.request, { ledovaSubmissionGuard: check });
        check();
        if (!isRegisterPersonRegistrationReceipt(data, command.request))
          throw createUserFriendlyError('The person receipt could not be confirmed. Retry the original save.');
        command.confirmed = true;
      }
      await client.invalidateQueries({ queryKey: allPeopleKey(owner) }, { throwOnError: true });
      check();
      pending.current = null;
      setHeld(false);
      setEditing(false);
      setOutcome(`${command.request.name} added.`);
    } catch (failure) {
      const status = failureStatus(failure);
      if (pending.current && !pending.current.confirmed) {
        if (!status || status >= 500) pending.current.uncertain = true;
        else if (!pending.current.uncertain) {
          pending.current = null;
          setHeld(false);
        }
      }
      try {
        guard();
        if (live.current) setError(failureSentence(failure, 'The person could not be added. Retry the original save.'));
      } catch {
        return;
      }
      void client.invalidateQueries({ queryKey: ownAppointmentsKey(owner) });
    } finally {
      running.current = false;
      if (live.current) {
        setBusy(false);
        callback.current(!!pending.current);
      }
    }
  };
  return {
    query,
    readable,
    appointments,
    peopleReady,
    canPrepare,
    editing,
    open,
    close,
    name,
    setName,
    address,
    setAddress,
    busy,
    held,
    error,
    outcome,
    problems,
    save,
  };
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  FIELD_LIMITS,
  appointmentForRegisterStep,
  createUserFriendlyError,
  failureSentence,
  failureStatus,
  hasCurrentRegisterReadAuthority,
  isRegisterPersonRegistrationReceipt,
  registerCompanyPerson,
  type RegisterPersonRegistrationRequest,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch } from '../../services/sessionScope';
import {
  peopleKey,
  registerAppointmentsKey,
  transferMembersKey,
  useCompanyPeople,
  useRegisterAppointments,
} from '../../hooks/useCompanyRegister';

export function usePersonRegistration({
  epoch,
  company,
  sourceReady,
  onHeldChange,
}: {
  epoch: number;
  company: string;
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
    assertSessionEpoch(epoch);
    if (!live.current) throw createUserFriendlyError('This person form is closed. Reopen Shareholders.');
    if (!ready.current) throw createUserFriendlyError('The current company could not be confirmed. Try again.');
  };
  const { appointments } = useRegisterAppointments(epoch, company);
  const settled = sourceReady && appointments.isSuccess && appointments.fetchStatus === 'idle';
  const authorised =
    sourceReady && appointments.isSuccess && hasCurrentRegisterReadAuthority(appointments.data, company);
  const readable = authorised && appointments.fetchStatus === 'idle';
  const query = useCompanyPeople(epoch, company, readable);
  const mayPrepare =
    sourceReady && appointments.isSuccess && !!appointmentForRegisterStep(appointments.data, company, 'prepare');
  const canPrepare = settled && mayPrepare;
  const peopleReady = readable && query.isSuccess && query.fetchStatus === 'idle';
  const problem = !name.trim()
    ? 'Give the person’s name.'
    : Array.from(name.trim()).length > FIELD_LIMITS.NAME
      ? `Keep the name within ${FIELD_LIMITS.NAME} characters.`
      : !address.trim()
        ? 'Give the person’s residential address.'
        : Array.from(address.trim()).length > FIELD_LIMITS.RESIDENTIAL_ADDRESS
          ? `Keep the address within ${FIELD_LIMITS.RESIDENTIAL_ADDRESS} characters.`
          : '';
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
    if (running.current) return;
    if (!pending.current && problem) {
      setError(problem);
      return;
    }
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
        const currentPeople = client.getQueryState(peopleKey(epoch, company));
        if (currentPeople?.status !== 'success' || currentPeople.fetchStatus !== 'idle')
          throw createUserFriendlyError('The current company people could not be confirmed. Try again.');
        command = {
          request: {
            operationId: Crypto.randomUUID(),
            company,
            appointment: appointment.uuid,
            member: Crypto.randomUUID(),
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
        const { data } = await registerCompanyPerson(apiClient, command.request, {
          ledovaSessionEpoch: epoch,
          ledovaSubmissionGuard: check,
        });
        check();
        if (!isRegisterPersonRegistrationReceipt(data, command.request))
          throw createUserFriendlyError('The person receipt could not be confirmed. Retry the original save.');
        command.confirmed = true;
      }
      await client.invalidateQueries({ queryKey: peopleKey(epoch) }, { throwOnError: true });
      check();
      void client.invalidateQueries({ queryKey: transferMembersKey(epoch) });
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
        assertSessionEpoch(epoch);
        if (live.current) setError(failureSentence(failure, 'The person could not be added. Retry the original save.'));
      } catch {
        return;
      }
      void client.invalidateQueries({ queryKey: registerAppointmentsKey(epoch) });
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
    authorised,
    appointments,
    peopleReady,
    mayPrepare,
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
    save,
  };
}

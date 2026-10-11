import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  REGISTER_ALLOTMENT_COPY as COPY,
  appointmentForRegisterStep,
  hasCurrentRegisterReadAuthority,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { useQueryClient } from '@tanstack/react-query';
import { registerSteps } from './proposals';
import { entriesKey } from './useRegisterCorrections';
import { registerKey } from './useCompanyRegister';
import { PageAction } from '@components/Page';
import { AllotmentForm } from './AllotmentForm';
import { AllotmentRecord } from './AllotmentRecord';
import { useOwnAppointments } from './useRegisterImports';
import { transferMembersKey, useTransferMembers } from './useRegisterTransfers';
import { allotmentsKey, useRegisterAllotments } from './useRegisterAllotments';

export function ClassAllotments({
  owner,
  company,
  register,
  guard,
  sourceReady = true,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady?: boolean;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [formHeld, setFormHeld] = useState(false);
  const live = useRef(true);
  const writeReady = useRef(false);
  const latestAppointments = useRef<OwnCompanyAppointment[]>([]);
  const appointments = useOwnAppointments(owner, guard);
  const readable = hasCurrentRegisterReadAuthority(appointments.isSuccess ? appointments.data : [], company);
  useLayoutEffect(() => {
    latestAppointments.current = appointments.isSuccess ? appointments.data : [];
  }, [appointments.isSuccess, appointments.data]);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const check = useMemo(
    () => () => {
      guard();
      if (!live.current) throw new Error('This allotment section is no longer open.');
      if (!hasCurrentRegisterReadAuthority(latestAppointments.current, company))
        throw new Error('A current company register appointment is required.');
    },
    [guard, company],
  );
  const token = register.token.uuid;
  const allotments = useRegisterAllotments(owner, company, token, check, readable);
  const financialGuard = () => {
    check();
    const current = client.getQueryState(allotmentsKey(owner, token));
    if (current?.status !== 'success' || current.fetchStatus !== 'idle')
      throw new Error('Refresh the external allotments before reading private sources.');
  };
  const appointment =
    readable && appointments.isSuccess ? appointmentForRegisterStep(appointments.data, company, 'prepare') : undefined;
  const supported = register.initialized && register.token.status === 'draft';
  const members = useTransferMembers(owner, token, check, editing && !!appointment && supported);
  const financialReady = allotments.isSuccess && allotments.fetchStatus === 'idle';
  const blocked =
    !readable ||
    !financialReady ||
    !sourceReady ||
    allotments.isFetching ||
    allotments.isError ||
    appointments.isFetching ||
    appointments.isError ||
    !supported;
  useLayoutEffect(() => {
    writeReady.current = !blocked;
  }, [blocked]);
  const refresh = async (throwOnError = false) => {
    check();
    await Promise.all([allotments.refetch({ throwOnError }), appointments.refetch({ throwOnError })]);
    check();
    await Promise.all([
      client.invalidateQueries({ queryKey: [...registerKey(owner), 'holders'] }),
      client.invalidateQueries({ queryKey: entriesKey(owner, token) }),
      client.invalidateQueries({ queryKey: transferMembersKey(owner, token) }),
    ]);
  };
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">{COPY.TITLE}</h3>
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
      {appointments.isError && (
        <>
          <p role="alert" className="text-sm text-error-light">
            Your appointments could not be read. Retry before recording an allotment.
          </p>
          <PageAction
            label="Retry allotment appointments"
            disabled={appointments.isFetching}
            onClick={() => void appointments.refetch()}
          />
        </>
      )}
      {appointments.isSuccess && !appointment && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>}
      {appointment && supported && (
        <PageAction
          label={editing ? 'Close allotment form' : COPY.PREPARE}
          disabled={blocked || formHeld}
          onClick={() => setEditing((value) => !value)}
        />
      )}
      {editing &&
        appointment &&
        supported &&
        (members.isPending ? (
          <p role="status" className="text-sm text-text-muted">
            Loading retained recipients…
          </p>
        ) : members.isError ? (
          <>
            <p role="alert" className="text-sm text-error-light">
              The retained recipients could not be read.
            </p>
            <PageAction
              label="Retry allotment recipients"
              disabled={members.isFetching}
              onClick={() => void members.refetch()}
            />
          </>
        ) : (
          <AllotmentForm
            key={`${company}/${token}/${appointment.uuid}`}
            company={company}
            token={token}
            members={members.data}
            appointment={appointment}
            guard={financialGuard}
            newEffectGuard={() => {
              if (
                !writeReady.current ||
                appointmentForRegisterStep(latestAppointments.current, company, 'prepare')?.uuid !== appointment.uuid
              )
                throw new Error('Refresh the register and your preparation appointment.');
            }}
            blocked={blocked || members.isFetching}
            onHeldChange={setFormHeld}
            onRecorded={async () => {
              check();
              await refresh(true);
              check();
              setEditing(false);
            }}
          />
        ))}
      {!readable ? (
        <p className="text-sm text-text-muted">
          A current company register appointment is required to read external allotments.
        </p>
      ) : allotments.isPending || allotments.isFetching ? (
        <p role="status" className="text-sm text-text-muted">
          Loading external allotments…
        </p>
      ) : (
        <>
          {allotments.isError && (
            <p role="alert" className="text-sm text-error-light">
              External allotments could not be read. A current company register appointment is required.
            </p>
          )}
          <PageAction
            label={allotments.isError ? 'Retry allotments' : 'Refresh allotments'}
            disabled={allotments.isFetching || appointments.isFetching}
            onClick={() => void refresh().catch(() => {})}
          />
          {financialReady && allotments.data?.length === 0 ? (
            <p className="text-sm text-text-muted">{COPY.EMPTY}</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {financialReady &&
                allotments.data?.map((allotment) => (
                  <AllotmentRecord
                    key={allotment.uuid}
                    allotment={allotment}
                    steps={registerSteps(appointments.isSuccess ? appointments.data : [], company)}
                    guard={financialGuard}
                    newEffectGuard={(kind) => {
                      check();
                      if (!writeReady.current || !appointmentForRegisterStep(latestAppointments.current, company, kind))
                        throw new Error('Refresh the register and your appointment before a new decision.');
                    }}
                    onSettled={() => refresh(true)}
                  />
                ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

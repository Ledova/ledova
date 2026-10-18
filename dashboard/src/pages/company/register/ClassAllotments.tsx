import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { generatePath } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_ALLOTMENT_COPY as COPY,
  appointmentForRegisterStep,
  hasCurrentRegisterReadAuthority,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { useQueryClient } from '@tanstack/react-query';
import { registerSteps } from '@pages/company/shared/proposals';
import { entriesKey } from '@pages/company/register/shared/useRegisterEntries';
import { registerKey } from '@hooks/useRegisterAccess';
import { PageAction } from '@components/Page';
import { LinkRow } from '@components/Ledger';
import { AllotmentForm } from './AllotmentForm';
import { AllotmentRecord } from './AllotmentRecord';
import { useOwnAppointments } from '@pages/company/shared/useOwnAppointments';
import { transferMembersKey, useTransferMembers } from '@pages/company/register/shared/useRegisterTransfers';
import { allotmentsKey, useRegisterAllotments } from './useRegisterAllotments';
import { ownAppointmentsKey } from '@pages/company/shared/appointments';

export function ClassAllotments({
  owner,
  company,
  register,
  guard,
  sourceReady = true,
  visible = true,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady?: boolean;
  visible?: boolean;
  onHeldChange?: (token: string, held: boolean) => void;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);
  const [decisionHolds, setDecisionHolds] = useState<Record<string, boolean>>({});
  const live = useRef(true);
  const writeReady = useRef(false);
  const sourceAvailable = useRef(sourceReady);
  const privateAvailable = useRef(false);
  const appointments = useOwnAppointments(owner, guard);
  const readable =
    appointments.isSuccess && !appointments.isFetching && hasCurrentRegisterReadAuthority(appointments.data, company);
  useLayoutEffect(() => {
    sourceAvailable.current = sourceReady;
  }, [sourceReady]);
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
      const state = client.getQueryState(ownAppointmentsKey(owner));
      if (!sourceAvailable.current || state?.status !== 'success' || state.fetchStatus !== 'idle')
        throw new Error('Refresh the register and current company appointments.');
      const current = client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [];
      if (!hasCurrentRegisterReadAuthority(current, company))
        throw new Error('A current company register appointment is required.');
    },
    [guard, company, client, owner],
  );
  const token = register.token.uuid;
  const allotments = useRegisterAllotments(owner, company, token, check, readable && sourceReady);
  const financialGuard = () => {
    check();
    const current = client.getQueryState(allotmentsKey(owner, token));
    if (!privateAvailable.current || current?.status !== 'success' || current.fetchStatus !== 'idle')
      throw new Error('Refresh the external allotments before reading private sources.');
  };
  const appointment =
    readable && appointments.isSuccess ? appointmentForRegisterStep(appointments.data, company, 'prepare') : undefined;
  const supported = register.initialized && register.token.status === 'draft';
  const members = useTransferMembers(owner, token, check, !!editing && !!appointment && supported && sourceReady);
  const financialReady = allotments.isSuccess && allotments.fetchStatus === 'idle';
  const privateReady = readable && financialReady && sourceReady && !appointments.isError;
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
    writeReady.current = !blocked && visible;
    privateAvailable.current = privateReady && visible;
  }, [blocked, privateReady, visible]);
  const recordHeld = useCallback((uuid: string, held: boolean) => {
    setDecisionHolds((current) => (current[uuid] === held ? current : { ...current, [uuid]: held }));
  }, []);
  const held = formHeld || Object.values(decisionHolds).some(Boolean);
  useEffect(() => {
    onHeldChange?.(token, held);
    return () => onHeldChange?.(token, false);
  }, [onHeldChange, token, held]);
  const refresh = async (throwOnError = false) => {
    guard();
    await appointments.refetch({ throwOnError });
    check();
    await allotments.refetch({ throwOnError });
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
      {!supported && sourceReady && (
        <p className="text-sm text-text-muted">
          {register.token.status === 'draft'
            ? 'Set up this share register before recording an investor share issue.'
            : 'Tokenised share issue controls remain in Share class settings.'}
        </p>
      )}
      {!supported && appointment && privateReady && (
        <LinkRow
          to={generatePath(
            (register.token.status === 'draft' ? DESTINATIONS.companyRegisterImport : DESTINATIONS.companyClass).path,
            { uuid: token },
          )}
          label={register.token.status === 'draft' ? 'Set up share register' : 'Share class settings'}
        />
      )}
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
      {appointment && supported && privateReady && (
        <PageAction
          label={editing ? 'Close allotment form' : COPY.PREPARE}
          disabled={blocked || held}
          onClick={() => setEditing((value) => (value ? null : appointment))}
        />
      )}
      {editing &&
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
        ) : null)}
      {editing && (
        <AllotmentForm
          key={`${company}/${token}/${editing.uuid}`}
          company={company}
          token={token}
          members={members.data ?? []}
          appointment={editing}
          guard={financialGuard}
          newEffectGuard={() => {
            if (
              !writeReady.current ||
              appointmentForRegisterStep(
                client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [],
                company,
                'prepare',
              )?.uuid !== editing.uuid
            )
              throw new Error('Refresh the register and your preparation appointment.');
          }}
          blocked={blocked || members.isFetching}
          visible={visible && privateReady && members.isSuccess && !members.isFetching}
          onHeldChange={setFormHeld}
          onRecorded={async () => {
            check();
            await refresh(true);
            check();
            setEditing(null);
          }}
        />
      )}
      {!readable ? (
        <p className="text-sm text-text-muted">
          A current company register appointment is required to read external allotments.
        </p>
      ) : allotments.isPending || allotments.isFetching || !sourceReady ? (
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
        </>
      )}
      {allotments.isError && (
        <PageAction
          label="Retry allotments"
          disabled={allotments.isFetching || appointments.isFetching}
          onClick={() => void refresh().catch(() => {})}
        />
      )}
      <ul className="space-y-4">
        {allotments.data?.map((allotment) => (
          <AllotmentRecord
            key={allotment.uuid}
            allotment={allotment}
            steps={registerSteps(appointments.isSuccess ? appointments.data : [], company)}
            guard={financialGuard}
            visible={visible && privateReady}
            onHeldChange={recordHeld}
            newEffectGuard={(kind) => {
              check();
              if (
                !writeReady.current ||
                !appointmentForRegisterStep(
                  client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [],
                  company,
                  kind,
                )
              )
                throw new Error('Refresh the register and your appointment before a new decision.');
            }}
            onSettled={() => refresh(true)}
          />
        ))}
      </ul>
    </div>
  );
}

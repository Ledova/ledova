import { registerHoldersKey } from '@pages/company/shared/useCompanyRegister';
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
  peopleFrom,
} from '@ledova/shared';
import { useQueryClient } from '@tanstack/react-query';
import { registerSteps } from '@pages/company/shared/proposals';
import { entriesKey } from '@pages/company/register/shared/useRegisterEntries';
import { LinkRow, LoadError } from '@components/Ledger';
import { AllotmentForm } from './AllotmentForm';
import { AllotmentRecord } from './AllotmentRecord';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { allPeopleKey, usePeople } from '@pages/company/register/shared/usePeople';
import { allotmentsKey, useRegisterAllotments } from './useRegisterAllotments';

export function useInvestorIssues({
  owner,
  company,
  register,
  guard,
  sourceReady = true,
  visible = true,
  onHeldChange,
  issueMember,
  open,
  kept,
  onClosed,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady?: boolean;
  visible?: boolean;
  onHeldChange?: (token: string, held: boolean) => void;
  issueMember?: string;
  open: boolean;
  kept: boolean;
  onClosed: () => void;
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
  const authority = useMemo(
    () => () => {
      guard();
      if (!live.current) throw new Error('This allotment section is no longer open.');
      const state = client.getQueryState(ownAppointmentsKey(owner));
      if (state?.status !== 'success' || state.fetchStatus !== 'idle')
        throw new Error('Refresh the register and current company appointments.');
      const current = client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [];
      if (!hasCurrentRegisterReadAuthority(current, company))
        throw new Error('A current company register appointment is required.');
    },
    [guard, company, client, owner],
  );
  const check = useMemo(
    () => () => {
      authority();
      if (!sourceAvailable.current) throw new Error('Refresh the register and current company appointments.');
    },
    [authority],
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
  const members = usePeople(owner, token, check, (open || !!editing) && !!appointment && supported && sourceReady);
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
  if (
    open &&
    !editing &&
    appointment &&
    supported &&
    privateReady &&
    !blocked &&
    !held &&
    (!issueMember || (members.isSuccess && !members.isFetching))
  )
    setEditing(appointment);
  if (!kept && editing && !formHeld) setEditing(null);
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
      client.invalidateQueries({ queryKey: registerHoldersKey(owner) }),
      client.invalidateQueries({ queryKey: entriesKey(owner, token) }),
      client.invalidateQueries({ queryKey: allPeopleKey(owner) }),
    ]);
  };
  const setup = !supported && (
    <>
      {sourceReady && (
        <p className="text-sm text-text-muted">
          {register.token.status === 'draft'
            ? 'Set up this share register before issuing shares.'
            : 'Tokenised share issue controls remain in Share class settings.'}
        </p>
      )}
      {appointment && privateReady && (
        <LinkRow
          to={generatePath(
            (register.token.status === 'draft' ? DESTINATIONS.companyRegisterImport : DESTINATIONS.companyClass).path,
            { uuid: token },
          )}
          label={register.token.status === 'draft' ? 'Set up share register' : 'Share class settings'}
        />
      )}
    </>
  );
  const form = editing && (
    <div hidden={!open} className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
      {members.isPending ? (
        <p role="status" className="text-sm text-text-muted">
          Loading retained recipients…
        </p>
      ) : members.isError ? (
        <LoadError retry={() => members.refetch()} busy={members.isFetching}>
          The retained recipients could not be loaded.
        </LoadError>
      ) : null}
      <AllotmentForm
        key={`${company}/${token}/${editing.uuid}/${issueMember ?? ''}`}
        company={company}
        token={token}
        people={peopleFrom(members.data)}
        initialMember={issueMember}
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
          authority();
          setEditing(null);
          onClosed();
        }}
      />
    </div>
  );
  const records = (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">Investor issues</h3>
      {appointments.isError && (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      )}
      {appointments.isSuccess && !appointment && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>}
      {!readable ? (
        <p className="text-sm text-text-muted">
          A current company register appointment is required to read external allotments.
        </p>
      ) : allotments.isPending || allotments.isFetching || !sourceReady ? (
        <p role="status" className="text-sm text-text-muted">
          Loading external allotments…
        </p>
      ) : allotments.isError ? (
        <LoadError retry={() => refresh().catch(() => {})} busy={allotments.isFetching || appointments.isFetching}>
          External allotments could not be loaded.
        </LoadError>
      ) : null}
      {privateReady && allotments.data?.length === 0 && <p className="text-sm text-text-muted">{COPY.EMPTY}</p>}
      <ul className="divide-y divide-border-subtle">
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
  return { setup, form, records, held, prepare: !!appointment && supported };
}

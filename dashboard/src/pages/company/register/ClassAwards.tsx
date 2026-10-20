import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_AWARD_COPY as COPY,
  appointmentForRegisterStep,
  hasCurrentRegisterReadAuthority,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
  peopleFrom,
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { AwardForm } from './AwardForm';
import { AwardRecord } from './AwardRecord';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { allPeopleKey, usePeople } from '@pages/company/register/shared/usePeople';
import { awardsKey, useRegisterAwards } from '@pages/company/register/shared/useRegisterAwards';
import { grantsKey, useRegisterGrants } from '@pages/company/register/shared/useRegisterGrants';

export function ClassAwards({
  owner,
  company,
  register,
  guard,
  sourceReady = true,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady?: boolean;
  onHeldChange?: (token: string, held: boolean) => void;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [formAppointment, setFormAppointment] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);
  const [recordHolds, setRecordHolds] = useState<Record<string, boolean>>({});
  const live = useRef(true);
  const heldCallback = useRef(onHeldChange);
  useLayoutEffect(() => {
    heldCallback.current = onHeldChange;
  }, [onHeldChange]);
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
      if (!live.current) throw new Error('This award section is no longer open.');
      if (!hasCurrentRegisterReadAuthority(latestAppointments.current, company))
        throw new Error('A current company register appointment is required.');
    },
    [guard, company],
  );
  const token = register.token.uuid;
  const awards = useRegisterAwards(owner, company, token, check, readable);
  const grants = useRegisterGrants(owner, company, token, check, readable && sourceReady);
  const appointment =
    readable && appointments.isSuccess ? appointmentForRegisterStep(appointments.data, company, 'prepare') : undefined;
  const supported = register.initialized && register.token.status === 'draft';
  const members = usePeople(owner, token, check, editing && !!appointment && supported);
  const blocked =
    !readable || !sourceReady || awards.isFetching || awards.isError || appointments.isFetching || appointments.isError;
  const visible =
    readable &&
    sourceReady &&
    !awards.isFetching &&
    !awards.isError &&
    !appointments.isFetching &&
    !appointments.isError;
  const held = formHeld || Object.values(recordHolds).some(Boolean);
  useLayoutEffect(() => {
    onHeldChange?.(token, held);
  }, [onHeldChange, token, held]);
  useLayoutEffect(() => () => heldCallback.current?.(token, false), [token]);
  const refresh = async (throwOnError = false) => {
    await appointments.refetch({ throwOnError });
    await Promise.all([
      client.invalidateQueries({
        queryKey: awardsKey(owner, token),
        predicate: ({ queryKey }) => queryKey.length > awardsKey(owner, token).length,
      }),
      awards.refetch({ throwOnError }),
      client.invalidateQueries({ queryKey: allPeopleKey(owner) }),
      client.invalidateQueries({ queryKey: grantsKey(owner, token) }),
    ]);
  };
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">{COPY.TITLE}</h3>
      <p className="text-sm text-text-muted">{COPY.NOTE}</p>
      {appointments.isError && (
        <>
          <p role="alert" className="text-sm text-error-light">
            Your appointments could not be read. Retry before recording an award.
          </p>
          <PageAction
            label="Retry award appointments"
            disabled={appointments.isFetching}
            onClick={() => void appointments.refetch()}
          />
        </>
      )}
      {appointments.isSuccess && !appointment && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>}
      {((appointment && supported) || (editing && formAppointment)) && (
        <PageAction
          label={editing ? 'Close award form' : COPY.PREPARE}
          disabled={blocked || held}
          onClick={() => {
            if (editing) {
              setEditing(false);
              setFormAppointment(null);
            } else if (appointment) {
              setFormAppointment(appointment);
              setEditing(true);
            }
          }}
        />
      )}
      {editing && members.isPending && (
        <p role="status" className="text-sm text-text-muted">
          Loading retained recipients…
        </p>
      )}
      {editing && members.isError && (
        <>
          <p role="alert" className="text-sm text-error-light">
            The retained recipients could not be read.
          </p>
          <PageAction
            label="Retry award recipients"
            disabled={members.isFetching}
            onClick={() => void members.refetch()}
          />
        </>
      )}
      {editing && formAppointment && (
        <AwardForm
          key={`${company}/${token}/${formAppointment.uuid}`}
          company={company}
          token={token}
          people={peopleFrom(members.data)}
          appointment={formAppointment}
          guard={check}
          blocked={blocked || (!formHeld && (members.isPending || members.isFetching || members.isError))}
          visible={visible && (formHeld || (members.isSuccess && !members.isFetching))}
          canPrepare={
            supported &&
            !!appointmentForRegisterStep(
              appointments.isSuccess ? appointments.data.filter((item) => item.uuid === formAppointment.uuid) : [],
              company,
              'prepare',
            )
          }
          onHeldChange={setFormHeld}
          onRecorded={async () => {
            check();
            await refresh(true);
            check();
            setFormHeld(false);
            setEditing(false);
            setFormAppointment(null);
          }}
        />
      )}
      {!readable ? (
        <p className="text-sm text-text-muted">
          A current company register appointment is required to read employee awards.
        </p>
      ) : awards.isPending ? (
        <p role="status" className="text-sm text-text-muted">
          Loading employee awards…
        </p>
      ) : null}
      {awards.isError && (
        <p role="alert" className="text-sm text-error-light">
          Employee awards could not be read. Retry before continuing.
        </p>
      )}
      {grants.isError && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-error-light">The non-paid issues prepared from these awards could not be read.</p>
          <PageAction
            label="Retry non-paid issues"
            disabled={grants.isFetching}
            onClick={() => void grants.refetch()}
          />
        </div>
      )}
      <PageAction
        label={awards.isError ? 'Retry awards' : 'Refresh awards'}
        disabled={awards.isFetching || appointments.isFetching}
        onClick={() => void refresh()}
      />
      {visible && awards.data?.length === 0 && <p className="text-sm text-text-muted">{COPY.EMPTY}</p>}
      <ul className="space-y-4">
        {awards.data?.map((award) => (
          <AwardRecord
            key={award.uuid}
            owner={owner}
            award={award}
            grants={grants.isSuccess ? grants.data.filter((grant) => grant.award === award.uuid) : []}
            appointment={supported ? appointment : undefined}
            guard={check}
            blocked={blocked}
            visible={visible}
            onHeldChange={(recordHeld) =>
              setRecordHolds((previous) =>
                previous[award.uuid] === recordHeld ? previous : { ...previous, [award.uuid]: recordHeld },
              )
            }
            onSettled={() => refresh(true)}
          />
        ))}
      </ul>
    </div>
  );
}

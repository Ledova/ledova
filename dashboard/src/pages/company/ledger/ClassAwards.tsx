import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { ownAppointmentsKey, useOwnAppointments } from '@hooks/useOwnAppointments';
import { registerKey } from '@hooks/useRegisterAccess';
import { allPeopleKey, usePeople } from '@pages/company/ledger/shared/usePeople';
import {
  awardsKey,
  awardVestingsKey,
  awardEndsKey,
  awardVestingReversalsKey,
  useRegisterAwards,
} from '@pages/company/ledger/shared/useRegisterAwards';
import { grantsKey, useRegisterGrants } from '@pages/company/ledger/shared/useRegisterGrants';
import { LoadError, Loading, Section } from '@components/Ledger';
import { useAwardFreshness } from './useAwardFreshness';

export function ClassAwards({
  owner,
  company,
  register,
  guard,
  sourceReady = true,
  active = true,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady?: boolean;
  active?: boolean;
  onHeldChange?: (token: string, held: boolean) => void;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [formAppointment, setFormAppointment] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);
  const [recordHolds, setRecordHolds] = useState<Record<string, boolean>>({});
  const [returnToAction, setReturnToAction] = useState(false);
  const preparation = useRef<HTMLDivElement>(null);
  const prepareAction = useRef<HTMLButtonElement>(null);
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
  useEffect(() => {
    if (active && editing) preparation.current?.focus();
  }, [active, editing]);
  useEffect(() => {
    if (active && !editing && returnToAction && !blocked && prepareAction.current) {
      prepareAction.current.focus();
      setReturnToAction(false);
    }
  }, [active, editing, returnToAction, blocked]);
  useLayoutEffect(() => {
    onHeldChange?.(token, held);
  }, [onHeldChange, token, held]);
  useLayoutEffect(() => () => heldCallback.current?.(token, false), [token]);
  const refresh = async (throwOnError = false, available?: () => boolean) => {
    await appointments.refetch({ cancelRefetch: false, throwOnError });
    guard();
    const current = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
    latestAppointments.current = current?.status === 'success' ? (current.data ?? []) : [];
    if (available && !available()) return;
    if (
      current?.status !== 'success' ||
      current.fetchStatus !== 'idle' ||
      !hasCurrentRegisterReadAuthority(current.data ?? [], company)
    )
      return;
    const currentAwards = await awards.refetch({ cancelRefetch: false, throwOnError });
    check();
    if (available && !available()) return;
    await Promise.all([
      client.invalidateQueries({
        queryKey: awardsKey(owner, token),
        predicate: ({ queryKey }) => queryKey.length > awardsKey(owner, token).length,
      }),
      ...(currentAwards.isSuccess
        ? currentAwards.data.flatMap((award) =>
            [
              awardVestingsKey(owner, award.uuid),
              awardEndsKey(owner, award.uuid),
              awardVestingReversalsKey(owner, award.uuid),
            ].map((queryKey) => client.invalidateQueries({ queryKey, exact: true }, { cancelRefetch: false })),
          )
        : []),
      client.invalidateQueries({ queryKey: allPeopleKey(owner) }),
      client.invalidateQueries({ queryKey: [...registerKey(owner), 'invitation-awards', company] }),
      client.invalidateQueries({ queryKey: [...registerKey(owner), 'member-awards', company] }),
      client.invalidateQueries({ queryKey: grantsKey(owner, token) }),
    ]);
  };
  useAwardFreshness({
    owner,
    token,
    guard,
    active,
    sourceReady,
    held,
    refreshRecords: (available) => refresh(true, available),
  });
  const status = (
    <>
      {appointments.isError && (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      )}
      {appointments.isSuccess && readable && !appointment && (
        <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
      )}
      {appointments.isError ? null : !appointments.isSuccess || (readable && awards.isPending) ? (
        <Loading>Loading employee awards…</Loading>
      ) : !readable ? (
        <p className="text-sm text-text-muted">
          A current company register appointment is required to read employee awards.
        </p>
      ) : null}
      {awards.isError && (
        <LoadError retry={refresh} busy={awards.isFetching || appointments.isFetching}>
          Employee awards could not be loaded.
        </LoadError>
      )}
      {grants.isError && (
        <LoadError retry={() => grants.refetch()} busy={grants.isFetching}>
          The non-paid issues prepared from these awards could not be loaded.
        </LoadError>
      )}
    </>
  );
  return (
    <div className="space-y-5">
      <Section
        title={
          editing
            ? COPY.PREPARE
            : sourceReady && readable
              ? `${register.token.name} · ${register.token.symbol}`
              : COPY.TITLE
        }
      >
        {editing && sourceReady && readable && (
          <p className="text-sm text-text-muted">
            {register.token.name} · {register.token.symbol}
          </p>
        )}
        {status}
        <div hidden={editing} className="space-y-4">
          {visible && awards.data?.length === 0 && <p className="text-sm text-text-muted">{COPY.EMPTY}</p>}
          <ul hidden={!awards.data?.length} className="space-y-4">
            {awards.data?.map((award) => (
              <AwardRecord
                key={award.uuid}
                owner={owner}
                award={award}
                grants={grants.isSuccess ? grants.data.filter((grant) => grant.award === award.uuid) : []}
                appointment={supported ? appointment : undefined}
                guard={check}
                blocked={blocked}
                visible={visible && !editing}
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
        <div ref={preparation} tabIndex={-1} hidden={!editing} className="space-y-4 focus:outline-none">
          {editing && members.isPending && <Loading>Loading retained recipients…</Loading>}
          {editing && members.isError && (
            <LoadError retry={() => members.refetch()} busy={members.isFetching}>
              The retained recipients could not be loaded.
            </LoadError>
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
              onCancel={() => {
                setEditing(false);
                setFormAppointment(null);
                setReturnToAction(true);
              }}
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
        </div>
      </Section>
      {!editing && appointment && supported && (
        <div className="flex flex-wrap justify-end gap-2">
          <PageAction
            ref={prepareAction}
            label={COPY.PREPARE}
            primary
            disabled={blocked || held}
            onClick={() => {
              setReturnToAction(false);
              setFormAppointment(appointment);
              setEditing(true);
            }}
          />
        </div>
      )}
    </div>
  );
}

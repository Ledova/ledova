import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_AWARD_COPY as COPY,
  appointmentForRegisterStep,
  formatDate,
  formatShareCount,
  hasCurrentRegisterReadAuthority,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
  peopleFrom,
} from '@ledova/shared';
import { PageAction } from '@components/Page';
import { AwardForm } from './AwardForm';
import { ownAppointmentsKey, READ_TIMING, useOwnAppointments } from '@hooks/useOwnAppointments';
import { registerKey } from '@hooks/useRegisterAccess';
import { allPeopleKey, usePeople } from '@pages/company/ledger/shared/usePeople';
import { awardsKey, useRegisterAwards } from '@pages/company/ledger/shared/useRegisterAwards';
import { awardPath } from '@pages/company/ledger/shared/awards';
import { LinkRow, LoadError, Loading, Section } from '@components/Ledger';

export function ClassAwards({
  owner,
  company,
  register,
  guard,
  sourceReady = true,
  active = true,
  onHeldChange,
  onEditingChange,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  register: TokenHoldersResponse;
  guard: () => void;
  sourceReady?: boolean;
  active?: boolean;
  onHeldChange?: (token: string, held: boolean) => void;
  onEditingChange?: (token: string, editing: boolean) => void;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [formAppointment, setFormAppointment] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);
  const [returnToAction, setReturnToAction] = useState(false);
  const preparation = useRef<HTMLDivElement>(null);
  const prepareAction = useRef<HTMLButtonElement>(null);
  const live = useRef(true);
  const entered = useRef(false);
  const heldCallback = useRef(onHeldChange);
  const editingCallback = useRef(onEditingChange);
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
  const entryRead = useRef({ active, sourceReady, formHeld, editing });
  useLayoutEffect(() => {
    entryRead.current = { active, sourceReady, formHeld, editing };
  }, [active, sourceReady, formHeld, editing]);
  useLayoutEffect(() => {
    editingCallback.current = onEditingChange;
    onEditingChange?.(token, editing);
  }, [onEditingChange, token, editing]);
  useLayoutEffect(() => () => editingCallback.current?.(token, false), [token]);
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
    onHeldChange?.(token, formHeld);
  }, [onHeldChange, token, formHeld]);
  useLayoutEffect(() => () => heldCallback.current?.(token, false), [token]);
  const refresh = async (throwOnError = false, available?: () => boolean) => {
    if (available && !available()) return;
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
    await awards.refetch({ cancelRefetch: false, throwOnError });
    check();
    if (available && !available()) return;
    await Promise.all([
      client.invalidateQueries({
        queryKey: awardsKey(owner, token),
        predicate: ({ queryKey }) => queryKey.length > awardsKey(owner, token).length,
      }),
      client.invalidateQueries({ queryKey: allPeopleKey(owner) }),
      client.invalidateQueries({ queryKey: [...registerKey(owner), 'invitation-awards', company] }),
      client.invalidateQueries({ queryKey: [...registerKey(owner), 'member-awards', company] }),
    ]);
  };
  useEffect(() => {
    if (!active) {
      entered.current = false;
      return;
    }
    if (
      entered.current ||
      !sourceReady ||
      formHeld ||
      editing ||
      [appointments, awards].some((read) => read.isFetching || read.isPending)
    )
      return;
    entered.current = true;
    const keys = [ownAppointmentsKey(owner), awardsKey(owner, token)];
    const stale = keys.some((queryKey) => {
      const query = client.getQueryCache().find({ queryKey, exact: true });
      return query?.state.status === 'success' && query.isStaleByTime(READ_TIMING.staleTime);
    });
    const available = () =>
      live.current &&
      entryRead.current.active &&
      entryRead.current.sourceReady &&
      !entryRead.current.formHeld &&
      !entryRead.current.editing;
    if (stale) void refresh(true, available).catch(() => {});
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
      {appointments.isError ? null : !appointments.isSuccess ||
        (readable && (awards.isPending || awards.isFetching || appointments.isFetching)) ? (
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
          {visible && !!awards.data?.length && (
            <div aria-hidden="true" className="hidden items-center gap-4 text-xs font-medium text-text-muted md:flex">
              <span className="flex-1">Recipient</span>
              <span className="grid w-[22.5rem] grid-cols-3 gap-6 text-right">
                <span>Promised</span>
                <span>Vested</span>
                <span>Issued</span>
              </span>
              <span className="w-4" />
            </div>
          )}
          <ul
            aria-label="Employee awards"
            hidden={!visible || !awards.data?.length}
            className="divide-y divide-border-subtle"
          >
            {visible &&
              awards.data?.map((award) => (
                <li key={award.uuid}>
                  <LinkRow
                    to={awardPath(token, award.uuid, company)}
                    state={{ registerCompany: company, registerToken: token }}
                    label={award.recipientName}
                    context={`employee award, agreement ${formatDate(award.termsOn)}`}
                    aside={
                      <span className="hidden w-[22.5rem] grid-cols-3 gap-6 text-right tabular-nums text-text-primary md:grid">
                        <span>
                          <span className="sr-only">Promised </span>
                          {formatShareCount(award.shares)}
                        </span>
                        <span>
                          <span className="sr-only">Vested </span>
                          {formatShareCount(award.vestedShares)}
                        </span>
                        <span>
                          <span className="sr-only">Issued </span>
                          {formatShareCount(award.issuedShares)}
                        </span>
                      </span>
                    }
                  >
                    <span className="block text-xs text-text-muted">Agreement {formatDate(award.termsOn)}</span>
                    <span className="block text-xs text-text-muted md:hidden">
                      {formatShareCount(award.shares)} promised · {formatShareCount(award.vestedShares)} vested ·{' '}
                      {formatShareCount(award.issuedShares)} issued
                    </span>
                  </LinkRow>
                </li>
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
            disabled={blocked || formHeld}
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

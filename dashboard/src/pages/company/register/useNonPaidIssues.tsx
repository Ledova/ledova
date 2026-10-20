import { registerHoldersKey } from '@pages/company/shared/useCompanyRegister';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  hasCurrentRegisterReadAuthority,
  appointmentForRegisterStep,
  peopleFrom,
  type RegisterDecisionKind,
  type OwnCompanyAppointment,
  REGISTER_GRANT_COPY as COPY,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { PageAction } from '@components/Page';

import { GrantForm } from './GrantForm';
import { GrantRecord } from './GrantRecord';
import { registerSteps } from '@pages/company/shared/proposals';
import { entriesKey } from '@pages/company/register/shared/useRegisterEntries';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { grantsKey, useRegisterGrants } from '@pages/company/register/shared/useRegisterGrants';
import { awardsKey, useRegisterAward } from '@pages/company/register/shared/useRegisterAwards';
import { allPeopleKey, usePeople } from '@pages/company/register/shared/usePeople';

const AWARD_NOTE =
  'Prepare the company’s issue of recorded vested shares. The employee does not purchase them; approval and recording the issue are separate steps.';

export function useNonPaidIssues({
  owner,
  guard,
  register,
  company,
  sourceReady = true,
  visible = true,
  onHeldChange,
  award: awardUuid = '',
  focusRecord,
  open,
  onClosed,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  register: TokenHoldersResponse;
  company: string;
  sourceReady?: boolean;
  visible?: boolean;
  onHeldChange?: (token: string, held: boolean) => void;
  award?: string;
  focusRecord?: { key: string; uuid: string };
  open: boolean;
  onClosed: () => void;
}) {
  const client = useQueryClient();
  const token = register.token.uuid;
  const source = useRef(sourceReady);
  useLayoutEffect(() => {
    source.current = sourceReady;
  }, [sourceReady]);
  const appointments = useOwnAppointments(owner, guard);
  const readable = hasCurrentRegisterReadAuthority(appointments.isSuccess ? appointments.data : [], company);
  const check = useMemo(
    () => () => {
      guard();
      const state = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
      if (
        !source.current ||
        state?.status !== 'success' ||
        state.fetchStatus !== 'idle' ||
        !hasCurrentRegisterReadAuthority(state.data ?? [], company)
      )
        throw new Error('Refresh the register and your current company appointment.');
    },
    [client, owner, company, guard],
  );
  const grants = useRegisterGrants(owner, company, token, check, readable && sourceReady);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : {};
  const privateReady = sourceReady && readable && grants.isSuccess && !grants.isFetching && !appointments.isFetching;
  const privateGuard = () => {
    check();
    const state = client.getQueryState(grantsKey(owner, token));
    if (state?.status !== 'success' || state.fetchStatus !== 'idle')
      throw new Error('Refresh the non-paid issues before continuing.');
  };
  const [heldRecords, setHeldRecords] = useState<ReadonlySet<string>>(() => new Set());
  const recordHeld = useCallback((uuid: string, held: boolean) => {
    setHeldRecords((current) => {
      if (current.has(uuid) === held) return current;
      const next = new Set(current);
      if (held) next.add(uuid);
      else next.delete(uuid);
      return next;
    });
  }, []);
  const [formAppointment, setFormAppointment] = useState<OwnCompanyAppointment | null>(null);
  const [formHeld, setFormHeld] = useState(false);
  const held = formHeld || heldRecords.size > 0;
  useEffect(() => {
    onHeldChange?.(token, held);
    return () => onHeldChange?.(token, false);
  }, [token, held, onHeldChange]);
  const refresh = async () => {
    guard();
    await appointments.refetch({ throwOnError: true });
    check();
    await grants.refetch({ throwOnError: true });
    check();
    await Promise.all(
      [awardsKey(owner, token), registerHoldersKey(owner), entriesKey(owner, token), allPeopleKey(owner)].map(
        (queryKey) => client.invalidateQueries({ queryKey }),
      ),
    );
  };
  const newEffectGuard = (kind: RegisterDecisionKind) => {
    privateGuard();
    const rows = client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [];
    if (!supported || !appointmentForRegisterStep(rows, company, kind))
      throw new Error('Current company authority is required for this issue.');
  };
  const supported = register.initialized && register.token.status === 'draft';
  const appointment =
    readable && appointments.isSuccess ? appointmentForRegisterStep(appointments.data, company, 'prepare') : undefined;
  const reading = (open || !!formAppointment) && !!appointment && supported && sourceReady;
  const people = usePeople(owner, token, check, reading);
  const award = useRegisterAward(owner, company, token, awardUuid, check, reading);
  const awardMember = people.data?.members.find((row) => row.member === award.data?.member) ?? null;
  const recipientReady =
    !awardUuid ||
    (award.isSuccess &&
      people.isSuccess &&
      !(
        (awardMember && (!awardMember.walletless || !awardMember.particularsRetained)) ||
        (!awardMember && (!award.data.newMember || BigInt(award.data.issuedShares) > 0n))
      ));
  const busy = appointments.isFetching || people.isFetching || (!!awardUuid && award.isFetching);
  const stale = appointments.isError || people.isError || (!!awardUuid && award.isError);
  const ready =
    sourceReady &&
    readable &&
    people.isSuccess &&
    (!awardUuid || award.isSuccess) &&
    (!!formAppointment || (!!appointment && supported && recipientReady));
  const formVisible = visible && ready && !stale && !busy;
  if (
    open &&
    formVisible &&
    appointment &&
    (!formAppointment || (!formHeld && formAppointment.uuid !== appointment.uuid))
  )
    setFormAppointment(appointment);
  if (!open && formAppointment && !formHeld) setFormAppointment(null);
  const retry = () => {
    void appointments.refetch();
    if (reading) {
      void people.refetch();
      if (awardUuid) void award.refetch();
    }
  };
  const form = open && (
    <>
      <p className="text-sm text-text-muted">{awardUuid ? AWARD_NOTE : COPY.NOTE}</p>
      {stale ? (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-error-light">The non-paid issue form could not be prepared. Try again.</p>
          <PageAction label="Retry non-paid issue" disabled={busy} onClick={retry} />
        </div>
      ) : appointments.isSuccess && !appointment && !formAppointment ? (
        <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
      ) : award.isSuccess && people.isSuccess && !recipientReady ? (
        <p className="text-sm text-text-muted">
          This award’s recipient needs current retained walletless particulars before a grant can be prepared.
        </p>
      ) : (
        !formVisible && (
          <p role="status" className="text-sm text-text-muted">
            Loading the non-paid issue form…
          </p>
        )
      )}
      {formAppointment && (
        <div hidden={!formVisible}>
          <GrantForm
            key={`${formAppointment.uuid}/${awardUuid}`}
            owner={owner}
            guard={check}
            company={company}
            token={token}
            people={peopleFrom(people.data)}
            appointment={formAppointment}
            blocked={!ready || stale || busy}
            visible={formVisible}
            onHeldChange={setFormHeld}
            canPrepare={
              supported &&
              recipientReady &&
              !!appointmentForRegisterStep(
                appointments.isSuccess ? appointments.data.filter((item) => item.uuid === formAppointment.uuid) : [],
                company,
                'prepare',
              )
            }
            onRefused={retry}
            onRecorded={() => {
              setFormAppointment(null);
              onClosed();
            }}
            award={awardUuid ? award.data : undefined}
            awardMember={awardMember}
          />
        </div>
      )}
    </>
  );
  const records = (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">Non-paid issues</h3>
      {appointments.isError && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-error-light">
            Your appointments could not be loaded. Retry before preparing or deciding a grant.
          </p>
          <PageAction
            label="Retry appointments"
            disabled={appointments.isFetching}
            onClick={() => void appointments.refetch()}
          />
        </div>
      )}
      {readable && !Object.values(steps).some(Boolean) && (
        <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
      )}
      {!sourceReady || grants.isPending ? (
        <p role="status" className="text-sm text-text-muted">
          Loading non-paid issues…
        </p>
      ) : !readable || grants.isError || appointments.isError ? (
        <div role="alert">
          <p className="text-sm text-error-light">
            The non-paid issues could not be read. Refresh current company access.
          </p>
          <PageAction
            label="Retry grants"
            disabled={grants.isFetching || appointments.isFetching}
            onClick={() => void refresh().catch(() => {})}
          />
        </div>
      ) : privateReady && grants.data.length === 0 ? (
        <p className="text-sm text-text-muted">{COPY.EMPTY}</p>
      ) : null}
      <PageAction
        label="Refresh grants"
        disabled={grants.isFetching || appointments.isFetching}
        onClick={() => void refresh().catch(() => {})}
      />
      <ul className="divide-y divide-border-subtle">
        {grants.data?.map((grant) => (
          <GrantRecord
            key={grant.uuid}
            grant={grant}
            steps={steps}
            guard={privateGuard}
            newEffectGuard={newEffectGuard}
            visible={visible && privateReady}
            focusKey={focusRecord?.uuid === grant.uuid ? focusRecord.key : undefined}
            onHeldChange={recordHeld}
            onSettled={refresh}
          />
        ))}
      </ul>
    </div>
  );
  return { form, records, held };
}

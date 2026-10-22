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

import { GrantForm } from './GrantForm';
import { GrantRecord } from './GrantRecord';
import { registerSteps } from '@pages/company/shared/proposals';
import { entriesKey } from '@pages/company/ledger/shared/useRegisterEntries';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { grantsKey, useRegisterGrants } from '@pages/company/ledger/shared/useRegisterGrants';
import { awardsKey, useRegisterAward } from '@pages/company/ledger/shared/useRegisterAwards';
import { allPeopleKey, usePeople } from '@pages/company/ledger/shared/usePeople';
import { LoadError, Loading } from '@components/Ledger';

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
  kept,
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
  kept: boolean;
  onClosed: (recorded?: boolean) => void;
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
  const [prepared, setPrepared] = useState('');
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
    !awardUuid || (award.isSuccess && people.isSuccess && !!awardMember?.walletless && awardMember.particularsRetained);
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
  if (!kept && formAppointment && !formHeld) setFormAppointment(null);
  const retry = async () => {
    await appointments.refetch();
    void client.invalidateQueries({ queryKey: registerHoldersKey(owner) });
    if (reading) {
      void people.refetch();
      if (awardUuid) void award.refetch();
    }
  };
  const shown = open || formHeld;
  const form = (shown || !!formAppointment) && (
    <div hidden={!shown} className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">{awardUuid ? AWARD_NOTE : COPY.NOTE}</p>
      {stale ? (
        <LoadError retry={retry} busy={busy}>
          The non-paid issue form could not be loaded.
        </LoadError>
      ) : appointments.isSuccess && !appointment && !formAppointment ? (
        <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
      ) : award.isSuccess && people.isSuccess && !recipientReady ? (
        <p className="text-sm text-text-muted">
          This award’s recipient needs current retained walletless particulars before a grant can be prepared.
        </p>
      ) : (
        !formVisible && <Loading>Loading the non-paid issue form…</Loading>
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
            onCancel={onClosed}
            onRecorded={(uuid) => {
              setPrepared(uuid);
              setFormAppointment(null);
              onClosed(true);
            }}
            award={awardUuid ? award.data : undefined}
            awardMember={awardMember}
          />
        </div>
      )}
    </div>
  );
  const status = (
    <>
      {appointments.isError && (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      )}
      {readable && !Object.values(steps).some(Boolean) && (
        <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
      )}
      {appointments.isError ? null : !appointments.isSuccess ||
        appointments.isFetching ||
        !sourceReady ||
        (readable && (grants.isPending || grants.isFetching)) ? (
        <Loading>Loading non-paid issues…</Loading>
      ) : !readable ? (
        <p className="text-sm text-text-muted">
          A current company register appointment is required to read non-paid issues.
        </p>
      ) : grants.isError ? (
        <LoadError retry={() => refresh().catch(() => {})} busy={grants.isFetching || appointments.isFetching}>
          Non-paid issues could not be loaded.
        </LoadError>
      ) : null}
    </>
  );
  const records = (
    <ul className="divide-y divide-border-subtle">
      {grants.data?.map((grant) => (
        <GrantRecord
          key={grant.uuid}
          grant={grant}
          steps={steps}
          guard={privateGuard}
          newEffectGuard={newEffectGuard}
          visible={visible && privateReady && !kept}
          focusKey={focusRecord?.uuid === grant.uuid ? focusRecord.key : prepared === grant.uuid ? prepared : undefined}
          onHeldChange={recordHeld}
          onSettled={refresh}
        />
      ))}
    </ul>
  );
  return {
    form,
    status,
    records,
    empty: privateReady && grants.data?.length === 0,
    held,
    refreshRecords: () => grants.refetch({ cancelRefetch: false, throwOnError: true }),
  };
}

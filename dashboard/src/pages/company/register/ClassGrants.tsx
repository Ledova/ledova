import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { generatePath } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  hasCurrentRegisterReadAuthority,
  appointmentForRegisterStep,
  type RegisterDecisionKind,
  type OwnCompanyAppointment,
  REGISTER_GRANT_COPY as COPY,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LinkRow } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { ownAppointmentsKey } from '@pages/company/shared/appointments';
import { GrantRecord } from './GrantRecord';
import { registerSteps } from '@pages/company/shared/proposals';
import { registerKey } from '@hooks/useRegisterAccess';
import { entriesKey } from '@pages/company/register/shared/useRegisterEntries';
import { useOwnAppointments } from '@pages/company/shared/useOwnAppointments';
import { grantsKey, useRegisterGrants } from '@pages/company/register/shared/useRegisterGrants';
import { awardsKey } from '@pages/company/register/shared/useRegisterAwards';
import { transferMembersKey } from '@pages/company/register/shared/useRegisterTransfers';

export function ClassGrants({
  owner,
  guard,
  register,
  company,
  sourceReady = true,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  register: TokenHoldersResponse;
  company: string;
  sourceReady?: boolean;
  onHeldChange?: (token: string, held: boolean) => void;
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
  useEffect(() => {
    onHeldChange?.(token, heldRecords.size > 0);
    return () => onHeldChange?.(token, false);
  }, [token, heldRecords.size, onHeldChange]);
  const refresh = async () => {
    guard();
    await appointments.refetch({ throwOnError: true });
    check();
    await grants.refetch({ throwOnError: true });
    check();
    await Promise.all(
      [
        awardsKey(owner, token),
        [...registerKey(owner), 'holders'],
        entriesKey(owner, token),
        transferMembersKey(owner, token),
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
  };
  const newEffectGuard = (kind: RegisterDecisionKind) => {
    privateGuard();
    const rows = client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [];
    if (!supported || !appointmentForRegisterStep(rows, company, kind))
      throw new Error('Current company authority is required for this issue.');
  };
  const supported = register.initialized && register.token.status === 'draft';
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">{COPY.TITLE}</h3>
      {privateReady && steps.prepare && supported && (
        <LinkRow to={generatePath(DESTINATIONS.companyRegisterGrant.path, { uuid: token })} label={COPY.PREPARE} />
      )}
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
            visible={privateReady}
            onHeldChange={recordHeld}
            onSettled={refresh}
          />
        ))}
      </ul>
    </div>
  );
}

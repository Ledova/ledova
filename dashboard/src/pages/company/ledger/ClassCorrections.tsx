import { registerHoldersKey } from '@hooks/useRegisterClasses';
import { allPeopleKey } from '@pages/company/ledger/shared/usePeople';
import { useCallback } from 'react';
import { generatePath } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_CORRECTION_COPY,
  hasCurrentRegisterReadAuthority,
  type TokenHoldersResponse,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { LoadError, Loading } from '@components/Ledger';
import { PageLink } from '@components/Page';

import { CorrectionRecord } from './CorrectionRecord';
import { ClassEntries } from './ClassEntries';
import { registerSteps } from '@pages/company/shared/proposals';
import { correctionsKey, useClassCorrections } from '@pages/company/ledger/shared/useClassCorrections';
import { entriesKey } from '@pages/company/ledger/shared/useRegisterEntries';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';

const COPY = REGISTER_CORRECTION_COPY;

export function ClassCorrections({
  landed,
  owner,
  guard,
  token,
  company,
  register,
  sourceReady = true,
  visible = true,
  onHeldChange,
}: {
  landed?: Landed;
  owner: OrderSubmissionOwner;
  guard: () => void;
  token: string;
  company: string;
  register: TokenHoldersResponse;
  sourceReady?: boolean;
  visible?: boolean;
  onHeldChange?: (token: string, uuid: string, held: boolean) => void;
}) {
  const client = useQueryClient();
  const appointments = useOwnAppointments(owner, guard);
  const corrections = useClassCorrections(owner, token, guard);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
  const privateReady =
    visible &&
    sourceReady &&
    corrections.isSuccess &&
    corrections.fetchStatus === 'idle' &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const recordHeld = useCallback(
    (uuid: string, held: boolean) => onHeldChange?.(token, uuid, held),
    [onHeldChange, token],
  );
  const refresh = async () => {
    try {
      guard();
    } catch {
      return;
    }
    await Promise.all(
      [
        correctionsKey(owner, token),
        allPeopleKey(owner),
        entriesKey(owner, token),
        registerHoldersKey(owner),
        ownAppointmentsKey(owner),
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
  };
  return (
    <>
      <ClassEntries
        owner={owner}
        guard={guard}
        company={company}
        register={register}
        sourceReady={sourceReady}
        visible={visible}
        renderAction={(entry, ready) =>
          ready && privateReady && steps?.prepare && entry.correctable ? (
            <PageLink
              to={generatePath(DESTINATIONS.companyRegisterCorrection.path, { uuid: token, entry: entry.uuid })}
              label={COPY.PREPARE}
              context={`entry ${entry.sequence}`}
            />
          ) : null
        }
      />
      <div
        hidden={!visible || (corrections.isSuccess && corrections.data.length === 0)}
        className="flex flex-col gap-3 border-t border-border-subtle pt-4"
      >
        <h3 className="text-sm font-medium text-text-primary">{COPY.TITLE}</h3>
        {appointments.isError ? (
          <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
            Your appointments could not be loaded.
          </LoadError>
        ) : (
          steps &&
          !Object.values(steps).some(Boolean) && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
        )}
        {corrections.isPending ? (
          <Loading>Loading corrections…</Loading>
        ) : corrections.isError ? (
          <LoadError retry={() => corrections.refetch()} busy={corrections.isFetching}>
            Corrections could not be loaded.
          </LoadError>
        ) : null}
        <ul className="divide-y divide-border-subtle">
          {(corrections.data ?? []).map((correction) => (
            <CorrectionRecord
              key={correction.proposal.uuid}
              landed={landed?.record === correction.proposal.uuid ? landed : undefined}
              correction={correction}
              visible={privateReady}
              onHeldChange={recordHeld}
              steps={steps ?? {}}
              guard={guard}
              onDecided={refresh}
              onRefused={refresh}
            />
          ))}
        </ul>
      </div>
    </>
  );
}

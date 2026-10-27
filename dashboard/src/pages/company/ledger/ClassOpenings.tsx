import { registerHoldersKey } from '@hooks/useRegisterClasses';
import { useCallback } from 'react';
import { generatePath } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  hasCurrentRegisterReadAuthority,
  REGISTER_OPENING_COPY,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LinkRow, LoadError, Loading } from '@components/Ledger';

import { OpeningRecord } from './OpeningRecord';
import { registerSteps } from '@pages/company/shared/proposals';
import { entriesKey } from '@pages/company/ledger/shared/useRegisterEntries';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { openingsKey, useRegisterOpenings } from '@pages/company/ledger/shared/useRegisterOpenings';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';

const COPY = REGISTER_OPENING_COPY;

export function ClassOpenings({
  landed,
  owner,
  guard,
  register,
  company,
  visible = true,
  onHeldChange,
}: {
  landed?: Landed;
  owner: OrderSubmissionOwner;
  guard: () => void;
  register: TokenHoldersResponse;
  company: string;
  visible?: boolean;
  onHeldChange?: (token: string, uuid: string, held: boolean) => void;
}) {
  const client = useQueryClient();
  const token = register.token.uuid;
  const openings = useRegisterOpenings(owner, token, guard);
  const appointments = useOwnAppointments(owner, guard);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
  const privateReady =
    visible &&
    openings.isSuccess &&
    openings.fetchStatus === 'idle' &&
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
      [openingsKey(owner, token), registerHoldersKey(owner), entriesKey(owner, token), ownAppointmentsKey(owner)].map(
        (queryKey) => client.invalidateQueries({ queryKey }),
      ),
    );
  };
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">{COPY.TITLE}</h3>
      {appointments.isError ? (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      ) : (
        steps && !Object.values(steps).some(Boolean) && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
      )}
      {privateReady && steps?.prepare && !register.initialized && (
        <div className="border-b border-border-subtle">
          <LinkRow
            to={generatePath(DESTINATIONS.companyRegisterOpening.path, { uuid: token })}
            label="Open this ledger"
          />
        </div>
      )}
      {openings.isPending ? (
        <Loading>Loading openings…</Loading>
      ) : openings.isError ? (
        <LoadError retry={() => openings.refetch()} busy={openings.isFetching}>
          Openings could not be loaded.
        </LoadError>
      ) : privateReady && openings.data.length === 0 ? (
        <p className="text-sm text-text-muted">{COPY.EMPTY}</p>
      ) : null}
      <ul className="divide-y divide-border-subtle">
        {(openings.data ?? []).map((proposal) => (
          <OpeningRecord
            key={proposal.uuid}
            landed={landed?.record === proposal.uuid ? landed : undefined}
            proposal={proposal}
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
  );
}

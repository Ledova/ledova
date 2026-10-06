import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_OPENING_COPY,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LinkRow } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { ownAppointmentsKey } from '../team/appointments';
import { OpeningRecord } from './OpeningRecord';
import { registerSteps } from './proposals';
import { registerKey } from './useCompanyRegister';
import { entriesKey } from './useRegisterCorrections';
import { useOwnAppointments } from './useRegisterImports';
import { openingsKey, useRegisterOpenings } from './useRegisterOpenings';

const COPY = REGISTER_OPENING_COPY;

export function ClassOpenings({
  owner,
  guard,
  register,
  company,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  register: TokenHoldersResponse;
  company: string;
}) {
  const client = useQueryClient();
  const token = register.token.uuid;
  const openings = useRegisterOpenings(owner, token, guard);
  const appointments = useOwnAppointments(owner, guard);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
  const refresh = async () => {
    try {
      guard();
    } catch {
      return;
    }
    await Promise.all(
      [
        openingsKey(owner, token),
        [...registerKey(owner), 'holders'],
        entriesKey(owner, token),
        ownAppointmentsKey(owner),
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
  };
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">{COPY.TITLE}</h3>
      {appointments.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
          <p>Your appointments could not be loaded. Retry before preparing or deciding an opening.</p>
          <PageAction
            label="Retry appointments"
            onClick={() => void appointments.refetch()}
            disabled={appointments.isFetching}
          />
        </div>
      ) : (
        steps && !Object.values(steps).some(Boolean) && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
      )}
      {steps?.prepare && !register.initialized && (
        <div className="border-b border-border-subtle">
          <LinkRow to={DESTINATIONS.companyRegisterOpening.path.replace(':uuid', token)} label={COPY.PREPARE} />
        </div>
      )}
      {openings.isPending ? (
        <p role="status" className="text-sm text-text-muted">
          Loading openings…
        </p>
      ) : openings.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
          <p>We couldn&apos;t load the openings for this share class.</p>
          <PageAction label="Retry openings" onClick={() => void openings.refetch()} disabled={openings.isFetching} />
        </div>
      ) : openings.data.length === 0 ? (
        <p className="text-sm text-text-muted">{COPY.EMPTY}</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {openings.data.map((proposal) => (
            <OpeningRecord
              key={proposal.uuid}
              proposal={proposal}
              steps={steps ?? {}}
              guard={guard}
              onDecided={refresh}
              onRefused={refresh}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

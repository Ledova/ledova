import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_TRANSFER_COPY as COPY,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LinkRow } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { ownAppointmentsKey } from '../team/appointments';
import { TransferRecord } from './TransferRecord';
import { registerSteps } from './proposals';
import { registerKey } from './useCompanyRegister';
import { entriesKey } from './useRegisterCorrections';
import { useOwnAppointments } from './useRegisterImports';
import { transferMembersKey, transfersKey, useRegisterTransfers } from './useRegisterTransfers';

export function ClassTransfers({
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
  const transfers = useRegisterTransfers(owner, company, token, guard);
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
        transfersKey(owner, token),
        transferMembersKey(owner, token),
        [...registerKey(owner), 'holders'],
        entriesKey(owner, token),
        ownAppointmentsKey(owner),
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
  };
  const supported = register.initialized && register.token.status === 'draft';
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">{COPY.TITLE}</h3>
      {steps?.prepare && supported && (
        <LinkRow to={DESTINATIONS.companyRegisterTransfer.path.replace(':uuid', token)} label={COPY.PREPARE} />
      )}
      {appointments.isError && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-error-light">
            Your appointments could not be loaded. Retry before preparing or deciding a transfer.
          </p>
          <PageAction
            label="Retry appointments"
            disabled={appointments.isFetching}
            onClick={() => void appointments.refetch()}
          />
        </div>
      )}
      {steps && !Object.values(steps).some(Boolean) && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>}
      {transfers.isPending ? (
        <p role="status" className="text-sm text-text-muted">
          Loading non-paid transfers…
        </p>
      ) : transfers.isError ? (
        <div role="alert">
          <p className="text-sm text-error-light">The transfers could not be loaded.</p>
          <PageAction
            label="Retry transfers"
            disabled={transfers.isFetching || appointments.isFetching}
            onClick={() => {
              void transfers.refetch();
              void appointments.refetch();
            }}
          />
        </div>
      ) : transfers.data.length === 0 ? (
        <p className="text-sm text-text-muted">{COPY.EMPTY}</p>
      ) : (
        <>
          <p className="text-sm text-text-muted">{COPY.RECOVERY_NOTE}</p>
          <PageAction
            label="Refresh transfers"
            disabled={transfers.isFetching || appointments.isFetching}
            onClick={() => void refresh()}
          />
          <ul className="divide-y divide-border-subtle">
            {transfers.data.map((transfer) => (
              <TransferRecord
                key={transfer.uuid}
                transfer={transfer}
                steps={steps ?? {}}
                guard={guard}
                onSettled={refresh}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

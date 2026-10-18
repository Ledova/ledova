import { useCallback } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  DESTINATIONS,
  hasCurrentRegisterReadAuthority,
  REGISTER_IMPORT_COPY,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LinkRow } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { ownAppointmentsKey } from '@pages/company/shared/appointments';
import { ImportRecord } from './ImportRecord';
import { registerSteps } from '@pages/company/shared/proposals';
import { registerKey } from '@hooks/useRegisterAccess';
import { entriesKey } from '@pages/company/register/shared/useRegisterEntries';
import { importsKey, useRegisterImports } from '@pages/company/register/shared/useRegisterImports';
import { useOwnAppointments } from '@pages/company/register/shared/useOwnAppointments';

export function ClassImports({
  owner,
  guard,
  register,
  company,
  visible = true,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  register: TokenHoldersResponse;
  company: string;
  visible?: boolean;
  onHeldChange?: (token: string, uuid: string, held: boolean) => void;
}) {
  const token = register.token.uuid;
  const client = useQueryClient();
  const imports = useRegisterImports(owner, token, guard);
  const appointments = useOwnAppointments(owner, guard);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
  const privateReady =
    visible &&
    imports.isSuccess &&
    imports.fetchStatus === 'idle' &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const recordHeld = useCallback(
    (uuid: string, held: boolean) => onHeldChange?.(token, uuid, held),
    [onHeldChange, token],
  );
  const refresh = async (keys: QueryKey[]) => {
    try {
      guard();
    } catch {
      return;
    }
    await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
  };
  const changed = [importsKey(owner, token), [...registerKey(owner), 'holders'], entriesKey(owner, token)];
  const decided = () => refresh(changed);
  const refused = () => refresh([...changed, ownAppointmentsKey(owner)]);
  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">{REGISTER_IMPORT_COPY.TITLE}</h3>
      {appointments.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
          <p>Your appointments could not be loaded. Retry before preparing or deciding an import.</p>
          <PageAction
            label="Retry appointments"
            onClick={() => void appointments.refetch()}
            disabled={appointments.isFetching}
          />
        </div>
      ) : (
        steps &&
        !Object.values(steps).some(Boolean) && (
          <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.READ_ONLY_NOTE}</p>
        )
      )}
      {privateReady &&
        steps?.prepare &&
        (register.initialized || register.token.status === 'draft') &&
        imports.isSuccess &&
        (!imports.data.some((proposal) => proposal.status === 'applied') ||
          imports.data.some((proposal) => proposal.correctionAllowed)) && (
          <div className="border-b border-border-subtle">
            <LinkRow
              to={DESTINATIONS.companyRegisterImport.path.replace(':uuid', token)}
              label={
                imports.data.some((proposal) => proposal.correctionAllowed)
                  ? 'Correct copied opening'
                  : REGISTER_IMPORT_COPY.PREPARE
              }
            />
          </div>
        )}
      {imports.isPending ? (
        <p role="status" className="text-sm text-text-muted">
          Loading imports…
        </p>
      ) : imports.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
          <p>We couldn&apos;t load the imports for this share class.</p>
          <PageAction label="Retry imports" onClick={() => void imports.refetch()} disabled={imports.isFetching} />
        </div>
      ) : null}
      <ul className="divide-y divide-border-subtle">
        {(imports.data ?? []).map((proposal) => (
          <ImportRecord
            key={proposal.uuid}
            proposal={proposal}
            visible={privateReady}
            onHeldChange={recordHeld}
            steps={steps ?? {}}
            guard={guard}
            onDecided={decided}
            onRefused={refused}
          />
        ))}
      </ul>
    </div>
  );
}

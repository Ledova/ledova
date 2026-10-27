import { registerHoldersKey } from '@hooks/useRegisterClasses';
import { useCallback } from 'react';
import { generatePath } from 'react-router-dom';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import {
  DESTINATIONS,
  hasCurrentRegisterReadAuthority,
  REGISTER_IMPORT_COPY,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LinkRow, LoadError, Loading } from '@components/Ledger';

import { ImportRecord } from './ImportRecord';
import { registerSteps } from '@pages/company/shared/proposals';
import { entriesKey } from '@pages/company/ledger/shared/useRegisterEntries';
import { importsKey, useRegisterImports } from '@pages/company/ledger/shared/useRegisterImports';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';

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
  const changed = [importsKey(owner, token), registerHoldersKey(owner), entriesKey(owner, token)];
  const decided = () => refresh(changed);
  const refused = () => refresh([...changed, ownAppointmentsKey(owner)]);
  return (
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
      <h3 className="text-sm font-medium text-text-primary">Opening records</h3>
      {appointments.isError ? (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
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
              to={generatePath(DESTINATIONS.companyRegisterImport.path, { uuid: token })}
              label={
                imports.data.some((proposal) => proposal.correctionAllowed)
                  ? 'Correct copied opening'
                  : REGISTER_IMPORT_COPY.PREPARE
              }
            />
          </div>
        )}
      {imports.isPending ? (
        <Loading>Loading imports…</Loading>
      ) : imports.isError ? (
        <LoadError retry={() => imports.refetch()} busy={imports.isFetching}>
          Imports could not be loaded.
        </LoadError>
      ) : privateReady && imports.data.length === 0 ? (
        <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.EMPTY}</p>
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

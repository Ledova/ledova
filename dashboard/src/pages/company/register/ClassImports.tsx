import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { DESTINATIONS, REGISTER_IMPORT_COPY, type OrderSubmissionOwner } from '@ledova/shared';
import { LinkRow } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { ownAppointmentsKey } from '../team/appointments';
import { ImportRecord } from './ImportRecord';
import { registerSteps } from './proposals';
import { registerKey } from './useCompanyRegister';
import { importsKey, useOwnAppointments, useRegisterImports } from './useRegisterImports';

export function ClassImports({
  owner,
  guard,
  token,
  company,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  token: string;
  company: string;
}) {
  const client = useQueryClient();
  const imports = useRegisterImports(owner, token, guard);
  const appointments = useOwnAppointments(owner, guard);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
  const refresh = async (keys: QueryKey[]) => {
    try {
      guard();
    } catch {
      return;
    }
    await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
  };
  const decided = () => refresh([importsKey(owner, token), [...registerKey(owner), 'holders']]);
  const refused = () =>
    refresh([importsKey(owner, token), [...registerKey(owner), 'holders'], ownAppointmentsKey(owner)]);
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
      {steps?.prepare && imports.isSuccess && !imports.data.some((proposal) => proposal.status === 'applied') && (
        <div className="border-b border-border-subtle">
          <LinkRow
            to={DESTINATIONS.companyRegisterImport.path.replace(':uuid', token)}
            label={REGISTER_IMPORT_COPY.PREPARE}
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
      ) : imports.data.length === 0 ? (
        <p className="text-sm text-text-muted">{REGISTER_IMPORT_COPY.EMPTY}</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {imports.data.map((proposal) => (
            <ImportRecord
              key={proposal.uuid}
              proposal={proposal}
              steps={steps ?? {}}
              guard={guard}
              onDecided={decided}
              onRefused={refused}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

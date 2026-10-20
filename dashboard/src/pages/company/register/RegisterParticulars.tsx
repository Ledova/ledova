import { registerEntriesKey } from '@pages/company/register/shared/useRegisterEntries';
import { allPeopleKey } from '@pages/company/register/shared/usePeople';
import { registerHoldersKey } from '@pages/company/shared/useCompanyRegister';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_PARTICULARS_COPY,
  hasCurrentRegisterReadAuthority,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Section, LoadError } from '@components/Ledger';

import { ParticularsRecord } from './ParticularsRecord';
import { registerMembers, registerSteps } from '@pages/company/shared/proposals';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { particularsKey, useRegisterParticulars } from '@pages/company/register/shared/useRegisterParticulars';

const COPY = REGISTER_PARTICULARS_COPY;

export function RegisterParticulars({
  owner,
  guard,
  company,
  registers,
  visible = true,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  registers: TokenHoldersResponse[];
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
}) {
  const client = useQueryClient();
  const changes = useRegisterParticulars(owner, company, guard);
  const appointments = useOwnAppointments(owner, guard);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
  const privateReady =
    visible &&
    changes.isSuccess &&
    changes.fetchStatus === 'idle' &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const names = registerMembers(registers);
  const refresh = async () => {
    try {
      guard();
    } catch {
      return;
    }
    await Promise.all(
      [
        particularsKey(owner, company),
        allPeopleKey(owner),
        registerHoldersKey(owner),
        registerEntriesKey(owner),
        ownAppointmentsKey(owner),
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
  };
  if (changes.isSuccess && changes.data.length === 0) return null;
  return (
    <Section title={COPY.TITLE}>
      {appointments.isError ? (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      ) : (
        steps && !Object.values(steps).some(Boolean) && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
      )}
      {changes.isPending ? (
        <p role="status" className="text-sm text-text-muted">
          Loading particulars changes…
        </p>
      ) : changes.isError ? (
        <LoadError retry={() => changes.refetch()} busy={changes.isFetching}>
          Particulars changes could not be loaded.
        </LoadError>
      ) : null}
      <ul className="divide-y divide-border-subtle">
        {(changes.data ?? []).map((change) => (
          <ParticularsRecord
            key={change.uuid}
            change={change}
            visible={privateReady}
            onHeldChange={onHeldChange}
            member={names.get(change.member) || COPY.UNNAMED_MEMBER}
            steps={steps ?? {}}
            guard={guard}
            onDecided={refresh}
            onRefused={refresh}
          />
        ))}
      </ul>
    </Section>
  );
}

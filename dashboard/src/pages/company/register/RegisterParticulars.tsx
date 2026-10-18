import { registerEntriesKey } from '@pages/company/register/shared/useRegisterEntries';
import { registerHoldersKey } from '@pages/company/shared/useCompanyRegister';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_PARTICULARS_COPY,
  hasCurrentRegisterReadAuthority,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Section } from '@components/Ledger';
import { PageAction } from '@components/Page';

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
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
          <p>Your appointments could not be loaded. Retry before preparing or deciding a particulars change.</p>
          <PageAction
            label="Retry appointments"
            onClick={() => void appointments.refetch()}
            disabled={appointments.isFetching}
          />
        </div>
      ) : (
        steps && !Object.values(steps).some(Boolean) && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
      )}
      {changes.isPending ? (
        <p role="status" className="text-sm text-text-muted">
          Loading particulars changes…
        </p>
      ) : changes.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
          <p>We couldn&apos;t load the particulars changes for this company.</p>
          <PageAction
            label="Retry particulars changes"
            onClick={() => void changes.refetch()}
            disabled={changes.isFetching}
          />
        </div>
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

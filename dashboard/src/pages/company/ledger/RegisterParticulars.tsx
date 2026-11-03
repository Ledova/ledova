import { usePeople } from '@pages/company/ledger/shared/usePeople';
import {
  REGISTER_PARTICULARS_COPY,
  hasCurrentRegisterReadAuthority,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Section, LoadError, Loading } from '@components/Ledger';

import { ParticularsRecord } from './ParticularsRecord';
import { registerMembers } from '@pages/company/shared/proposals';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { useRegisterParticulars } from '@pages/company/ledger/shared/useRegisterParticulars';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';

const COPY = REGISTER_PARTICULARS_COPY;

export function RegisterParticulars({
  landed,
  owner,
  guard,
  company,
  registers,
  visible = true,
}: {
  landed?: Landed;
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  registers: TokenHoldersResponse[];
  visible?: boolean;
}) {
  const changes = useRegisterParticulars(owner, company, guard);
  const appointments = useOwnAppointments(owner, guard);
  const privateReady =
    visible &&
    changes.isSuccess &&
    changes.fetchStatus === 'idle' &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const names = registerMembers(registers);
  const firstClass = registers[0]?.token.uuid ?? '';
  const people = usePeople(
    owner,
    firstClass,
    guard,
    visible && !!firstClass && (changes.data ?? []).some((change) => !names.get(change.member)),
  );
  const nameOf = (member: string) =>
    names.get(member) || people.data?.members.find((row) => row.member === member)?.name || COPY.UNNAMED_MEMBER;
  if (changes.isSuccess && changes.data.length === 0) return null;
  return (
    <Section title={COPY.TITLE}>
      {appointments.isError && (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      )}
      {changes.isPending ? (
        <Loading>Loading particulars changes…</Loading>
      ) : changes.isError ? (
        <LoadError retry={() => changes.refetch()} busy={changes.isFetching}>
          Particulars changes could not be loaded.
        </LoadError>
      ) : null}
      <ul className="divide-y divide-border-subtle">
        {(changes.data ?? []).map((change) => (
          <ParticularsRecord
            key={change.uuid}
            landed={landed?.record === change.uuid ? landed : undefined}
            change={change}
            visible={privateReady}
            member={nameOf(change.member)}
            guard={guard}
          />
        ))}
      </ul>
    </Section>
  );
}

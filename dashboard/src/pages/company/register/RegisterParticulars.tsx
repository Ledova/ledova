import { registerEntriesKey } from '@pages/company/register/shared/useRegisterEntries';
import { allPeopleKey, usePeople } from '@pages/company/register/shared/usePeople';
import { awardsKey } from '@pages/company/register/shared/useRegisterAwards';
import { registerKey } from '@hooks/useRegisterAccess';
import { registerHoldersKey } from '@pages/company/shared/useCompanyRegister';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_PARTICULARS_COPY,
  hasCurrentRegisterReadAuthority,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Section, LoadError, Loading } from '@components/Ledger';

import { ParticularsRecord } from './ParticularsRecord';
import { registerMembers, registerSteps } from '@pages/company/shared/proposals';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { particularsKey, useRegisterParticulars } from '@pages/company/register/shared/useRegisterParticulars';
import type { Landed } from '@pages/company/register/shared/registerPlace';

const COPY = REGISTER_PARTICULARS_COPY;

export function RegisterParticulars({
  landed,
  owner,
  guard,
  company,
  registers,
  visible = true,
  onHeldChange,
}: {
  landed?: Landed;
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
  const firstClass = registers[0]?.token.uuid ?? '';
  const people = usePeople(
    owner,
    firstClass,
    guard,
    visible && !!firstClass && (changes.data ?? []).some((change) => !names.get(change.member)),
  );
  const nameOf = (member: string) =>
    names.get(member) || people.data?.members.find((row) => row.member === member)?.name || COPY.UNNAMED_MEMBER;
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
        ...registers.map(({ token }) => awardsKey(owner, token.uuid)),
        [...registerKey(owner), 'member-awards', company],
        [...registerKey(owner), 'invitation-awards', company],
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
            onHeldChange={onHeldChange}
            member={nameOf(change.member)}
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

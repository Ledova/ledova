import type { ReactNode } from 'react';
import {
  PARTICULARS_GROUPS,
  REGISTER_PARTICULARS_COPY,
  hasCurrentRegisterReadAuthority,
  registerMembers,
  type OrderSubmissionOwner,
  type RecordRow,
  type TokenHoldersResponse,
  useOwnAppointments,
  usePeople,
  useRegisterParticulars,
} from '@ledova/shared';
import { Section, LoadError, Loading } from '@components/Ledger';

import { GroupedRecords } from './GroupedRecords';
import { ParticularsRecord } from './ParticularsRecord';
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
  const rows: RecordRow<ReactNode>[] = (changes.data ?? []).map((change) => ({
    uuid: change.uuid,
    stage: change.stage,
    companyEventOn: change.asAt,
    createdAt: change.createdAt,
    shown: privateReady,
    held: false,
    render: ({ collapsed, ruled }) => (
      <ParticularsRecord
        landed={landed?.record === change.uuid ? landed : undefined}
        change={change}
        visible={privateReady}
        collapsed={collapsed}
        ruled={ruled}
        member={nameOf(change.member)}
        guard={guard}
      />
    ),
  }));
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
      <GroupedRecords grouping={PARTICULARS_GROUPS} rows={rows} requested={landed} />
    </Section>
  );
}

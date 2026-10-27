import { registerEntriesKey } from '@pages/company/ledger/shared/useRegisterEntries';
import { allPeopleKey, usePeople } from '@pages/company/ledger/shared/usePeople';
import { awardsKey } from '@pages/company/ledger/shared/useRegisterAwards';
import { registerKey } from '@hooks/useRegisterAccess';
import { registerHoldersKey } from '@hooks/useRegisterClasses';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
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
import { particularsKey, useRegisterParticulars } from '@pages/company/ledger/shared/useRegisterParticulars';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';

const COPY = REGISTER_PARTICULARS_COPY;

export function RegisterParticulars({
  landed,
  owner,
  guard,
  company,
  registers,
  visible = true,
  onHeldChange,
  onReviewChange,
}: {
  landed?: Landed;
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  registers: TokenHoldersResponse[];
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
  onReviewChange?: (company: string, open: boolean) => void;
}) {
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<HTMLDivElement | null>(null);
  const reviewChanged = useCallback(
    (uuid: string, open: boolean) => {
      setReviewing((current) => (open ? uuid : current === uuid ? null : current));
      onReviewChange?.(company, open);
    },
    [company, onReviewChange],
  );
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
  const status = (
    <>
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
    </>
  );
  return (
    <>
      <div hidden={!!reviewing}>
        <Section title={COPY.TITLE}>
          {!reviewing && status}
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
                reviewTarget={reviewTarget}
                onReviewChange={reviewChanged}
              />
            ))}
          </ul>
        </Section>
      </div>
      <div hidden={!reviewing} className="space-y-5">
        {reviewing && status}
        <div ref={setReviewTarget} />
      </div>
    </>
  );
}

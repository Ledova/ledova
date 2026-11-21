import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CORRECTION_GROUPS,
  REGISTER_CORRECTION_COPY,
  hasCurrentRegisterReadAuthority,
  type RecordRow,
  type RegisterEntry,
  type TokenHoldersResponse,
  type OrderSubmissionOwner,
  registerHoldersKey,
  useOwnAppointments,
  ownAppointmentsKey,
  allPeopleKey,
  registerSteps,
  entriesKey,
  correctionsKey,
  entryLabel,
  entryWithPeople,
  useClassCorrections,
  useRegisterEntryDeletion,
} from '@ledova/shared';
import { Failure, LoadError, Loading, Outcome } from '@components/Ledger';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';

import { CorrectionRecord } from './CorrectionRecord';
import { ClassEntries } from './ClassEntries';
import { GroupedRecords } from './GroupedRecords';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';

const COPY = REGISTER_CORRECTION_COPY;

export function ClassCorrections({
  landed,
  owner,
  guard,
  token,
  company,
  register,
  sourceReady = true,
  visible = true,
  onHeldChange,
}: {
  landed?: Landed;
  owner: OrderSubmissionOwner;
  guard: () => void;
  token: string;
  company: string;
  register: TokenHoldersResponse;
  sourceReady?: boolean;
  visible?: boolean;
  onHeldChange?: (token: string, uuid: string, held: boolean) => void;
}) {
  const client = useQueryClient();
  const appointments = useOwnAppointments(owner, guard);
  const corrections = useClassCorrections(owner, token, guard);
  const removal = useRegisterEntryDeletion({ owner, token, guard });
  const [deleting, setDeleting] = useState<RegisterEntry | null>(null);
  const changes = useRef<HTMLDivElement>(null);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
  const privateReady =
    visible &&
    sourceReady &&
    corrections.isSuccess &&
    corrections.fetchStatus === 'idle' &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const [heldRecords, setHeldRecords] = useState<ReadonlySet<string>>(() => new Set());
  const recordHeld = useCallback(
    (uuid: string, held: boolean) => {
      setHeldRecords((current) => {
        if (current.has(uuid) === held) return current;
        const next = new Set(current);
        if (held) next.add(uuid);
        else next.delete(uuid);
        return next;
      });
      onHeldChange?.(token, uuid, held);
    },
    [onHeldChange, token],
  );
  const refresh = async () => {
    try {
      guard();
    } catch {
      return;
    }
    await Promise.all(
      [
        correctionsKey(owner, token),
        allPeopleKey(owner),
        entriesKey(owner, token),
        registerHoldersKey(owner),
        ownAppointmentsKey(owner),
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
  };
  const rows: RecordRow<ReactNode>[] = (corrections.data ?? []).map((correction) => ({
    uuid: correction.proposal.uuid,
    stage: correction.proposal.stage,
    companyEventOn: correction.proposal.effectiveOn,
    createdAt: correction.proposal.createdAt,
    shown: privateReady,
    held: heldRecords.has(correction.proposal.uuid),
    render: ({ collapsed, ruled }) => (
      <CorrectionRecord
        landed={landed?.record === correction.proposal.uuid ? landed : undefined}
        correction={correction}
        visible={privateReady}
        collapsed={collapsed}
        ruled={ruled}
        onHeldChange={recordHeld}
        steps={steps ?? {}}
        guard={guard}
        onDecided={refresh}
        onRefused={refresh}
      />
    ),
  }));
  return (
    <>
      <div ref={changes} tabIndex={-1} className="flex flex-col gap-3 focus:outline-none">
        <ClassEntries
          owner={owner}
          guard={guard}
          company={company}
          register={register}
          sourceReady={sourceReady}
          visible={visible}
          renderAction={(entry, ready) =>
            ready && privateReady && steps?.prepare && entry.deletable ? (
              <PageAction
                compact
                destructive
                label="Delete"
                context={entryLabel(entry)}
                disabled={removal.busy}
                onClick={() => setDeleting(entry)}
              />
            ) : null
          }
        />
        {visible && <Outcome>{removal.outcome}</Outcome>}
        {visible && <Failure>{removal.error}</Failure>}
      </div>
      <Modal
        isOpen={!!deleting}
        onClose={() => {
          if (!removal.busy) setDeleting(null);
        }}
        title={`Delete this ${deleting ? (COPY.ENTRY_KINDS[deleting.kind] ?? 'entry').toLowerCase() : 'entry'}?`}
        showFooter
        confirmLabel="Delete"
        destructive
        busy={removal.busy}
        busyLabel="Deleting…"
        onConfirm={() => {
          if (deleting)
            void removal.remove(deleting).finally(() => {
              setDeleting(null);
              requestAnimationFrame(() => changes.current?.focus());
            });
        }}
      >
        <p className="break-words text-sm text-text-primary">
          The {deleting ? entryWithPeople(deleting) : 'entry'} is removed for everyone, with the records behind it. This
          can’t be undone.
        </p>
      </Modal>
      <div
        hidden={!visible || (corrections.isSuccess && corrections.data.length === 0)}
        className="flex flex-col gap-3 border-t border-border-subtle pt-4"
      >
        <h3 className="text-sm font-medium text-text-primary">{COPY.TITLE}</h3>
        {appointments.isError ? (
          <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
            Your appointments could not be loaded.
          </LoadError>
        ) : (
          steps &&
          !Object.values(steps).some(Boolean) && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
        )}
        {corrections.isPending ? (
          <Loading>Loading corrections…</Loading>
        ) : corrections.isError ? (
          <LoadError retry={() => corrections.refetch()} busy={corrections.isFetching}>
            Corrections could not be loaded.
          </LoadError>
        ) : null}
        <GroupedRecords grouping={CORRECTION_GROUPS} rows={rows} requested={landed} heading="h4" />
      </div>
    </>
  );
}

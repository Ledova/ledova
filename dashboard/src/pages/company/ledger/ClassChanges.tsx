import { useRef, useState } from 'react';
import {
  REGISTER_ENTRY_COPY,
  hasCurrentRegisterReadAuthority,
  type RegisterEntry,
  type TokenHoldersResponse,
  type OrderSubmissionOwner,
  useOwnAppointments,
  registerSteps,
  entryLabel,
  entryWithPeople,
  useRegisterEntryDeletion,
} from '@ledova/shared';
import { Failure, LoadError, Outcome } from '@components/Ledger';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';

import { ClassEntries } from './ClassEntries';

export function ClassChanges({
  owner,
  guard,
  token,
  company,
  register,
  sourceReady = true,
  visible = true,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  token: string;
  company: string;
  register: TokenHoldersResponse;
  sourceReady?: boolean;
  visible?: boolean;
}) {
  const appointments = useOwnAppointments(owner, guard);
  const removal = useRegisterEntryDeletion({ owner, token, guard });
  const [deleting, setDeleting] = useState<RegisterEntry | null>(null);
  const changes = useRef<HTMLDivElement>(null);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
  const privateReady =
    visible &&
    sourceReady &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  return (
    <>
      <div ref={changes} tabIndex={-1} className="flex flex-col gap-3 focus:outline-none">
        {visible && appointments.isError && (
          <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
            Your appointments could not be loaded.
          </LoadError>
        )}
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
        title={`Delete this ${deleting ? (REGISTER_ENTRY_COPY.ENTRY_KINDS[deleting.kind] ?? 'entry').toLowerCase() : 'entry'}?`}
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
    </>
  );
}

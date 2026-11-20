import { useEffect, useRef, useState } from 'react';
import {
  usePersonRegistration,
  type OrderSubmissionOwner,
  type Person,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { ErrorSummary } from '@components/ErrorSummary';
import { Loading, LoadError, Outcome, Section, Failure } from '@components/Ledger';
import { Modal } from '@components/Modal';
import { Actions, FormActions, PageAction } from '@components/Page';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { FormerShareholders } from './shared/FormerShareholders';
import { CompanyShareholders } from './CompanyShareholders';
import { PersonFields } from './shared/PersonPicker';

function PersonForm({ person }: { person: ReturnType<typeof usePersonRegistration> }) {
  const form = useRef<HTMLFormElement>(null);
  const checks = useErrorSummary(person.problems);
  useEffect(() => {
    form.current?.querySelector('input')?.focus();
  }, []);
  return (
    <Section title="Add person">
      <form
        ref={form}
        aria-label="Add person"
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (person.held || checks.check()) void person.save();
        }}
      >
        <ErrorSummary {...checks.summary} />
        <fieldset disabled={person.busy || person.held || !person.canPrepare} className="grid gap-4 sm:grid-cols-2">
          <PersonFields
            name={person.name}
            residentialAddress={person.address}
            onName={person.setName}
            onResidentialAddress={person.setAddress}
            nameCheck={checks.field('name')}
            addressCheck={checks.field('address')}
          />
        </fieldset>
        <Failure>{person.error}</Failure>
        <FormActions>
          <PageAction label="Cancel" disabled={person.busy || person.held} onClick={person.close} />
          <PageAction
            type="submit"
            primary
            label={person.held ? 'Retry original save' : 'Add'}
            context="person"
            busy={person.busy}
            busyLabel="Adding…"
            disabled={!person.held && (!person.canPrepare || !person.peopleReady)}
          />
        </FormActions>
      </form>
    </Section>
  );
}

export function CompanyPeople({
  owner,
  guard,
  company,
  registers,
  sourceReady,
  visible,
  blocked,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  registers: TokenHoldersResponse[];
  sourceReady: boolean;
  visible: boolean;
  blocked: boolean;
  onHeldChange: (held: boolean) => void;
}) {
  const person = usePersonRegistration({
    owner,
    guard,
    company,
    sourceReady,
    onHeldChange,
    newKey: () => crypto.randomUUID(),
  });
  const add = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const [deleting, setDeleting] = useState<Person | null>(null);
  useEffect(() => {
    if (person.editing) wasEditing.current = true;
    else if (wasEditing.current && person.peopleReady) {
      add.current?.focus();
      wasEditing.current = false;
    }
  }, [person.editing, person.peopleReady]);
  return (
    <>
      <CompanyShareholders
        registers={registers}
        company={company}
        visible={visible}
        blocked={blocked}
        people={person.peopleReady ? person.query.data : []}
        onDelete={person.canPrepare && !person.editing ? setDeleting : undefined}
        deleting={person.busy}
      />
      <FormerShareholders registers={registers} company={company} blocked={blocked} />
      {person.readable && person.query.isError ? (
        <LoadError retry={() => person.query.refetch()} busy={person.query.isFetching}>
          The company people could not be loaded.
        </LoadError>
      ) : person.readable && !person.peopleReady ? (
        <Loading>Loading company people…</Loading>
      ) : null}
      <Outcome>{person.outcome}</Outcome>
      {!person.editing && <Failure>{person.error}</Failure>}
      {person.appointments.isError && (
        <LoadError retry={() => person.appointments.refetch()} busy={person.appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      )}
      {person.editing ? (
        <PersonForm person={person} />
      ) : person.canPrepare ? (
        <Actions>
          <PageAction
            ref={add}
            primary
            label="Add"
            context="person"
            disabled={blocked || !person.peopleReady}
            onClick={person.open}
          />
        </Actions>
      ) : null}
      <Modal
        isOpen={!!deleting}
        onClose={() => {
          if (!person.busy) setDeleting(null);
        }}
        title="Delete this person?"
        showFooter
        confirmLabel="Delete"
        destructive
        busy={person.busy}
        busyLabel="Deleting…"
        onConfirm={() => {
          if (deleting) void person.remove(deleting).finally(() => setDeleting(null));
        }}
      >
        <p className="break-words text-sm text-text-primary">
          {deleting?.name}’s particulars, and any access they have to their records, are removed for everyone. This
          can’t be undone.
        </p>
      </Modal>
    </>
  );
}

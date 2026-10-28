import { useEffect, useRef } from 'react';
import type { OrderSubmissionOwner, TokenHoldersResponse } from '@ledova/shared';
import { ErrorSummary } from '@components/ErrorSummary';
import { Loading, LoadError, Outcome, Section } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { useErrorSummary } from '@hooks/useErrorSummary';
import { FormerShareholders } from './shared/ClassRegister';
import { CompanyShareholders } from './CompanyShareholders';
import { PersonFields } from './shared/PersonPicker';
import { usePersonRegistration } from './usePersonRegistration';

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
        {person.error && (
          <p role="alert" className="text-sm text-error-light">
            {person.error}
          </p>
        )}
        <FormActions>
          <PageAction label="Cancel" disabled={person.busy || person.held} onClick={person.close} />
          <PageAction
            type="submit"
            primary
            label={person.held ? 'Retry original save' : 'Add person'}
            busy={person.busy}
            busyLabel="Adding person…"
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
  const person = usePersonRegistration({ owner, guard, company, sourceReady, onHeldChange });
  const add = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
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
      {person.appointments.isError && (
        <LoadError retry={() => person.appointments.refetch()} busy={person.appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      )}
      {person.editing ? (
        <PersonForm person={person} />
      ) : person.canPrepare ? (
        <div className="flex flex-wrap justify-end gap-2">
          <PageAction
            ref={add}
            primary
            label="Add person"
            disabled={blocked || !person.peopleReady}
            onClick={person.open}
          />
        </div>
      ) : null}
    </>
  );
}
